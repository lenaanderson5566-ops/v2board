<?php
namespace App\Services;

use App\Models\RiskSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class ProductAnalytics {
    public const PAGES = ['landing','register','login','forget','dashboard','plan','confirmation','payment','order','order_detail','activities','coupons','subscribe','knowledge','profile','security','invite','traffic','notifications','ticket','browser_guide','browser_prompt'];
    public function settings(): array {
        return Cache::remember('PRODUCT_ANALYTICS_SETTINGS', 60, function () {
            $values = RiskSetting::whereIn('key', ['analytics_enabled','analytics_retention_days'])->pluck('value','key');
            $days = (int)($values['analytics_retention_days'] ?? 30);
            return ['enabled'=>($values['analytics_enabled'] ?? '0') === '1', 'retentionDays'=>in_array($days,[7,30,90],true) ? $days : 30];
        });
    }
    public function ready(): bool { return Schema::hasTable('v2_analytics_session') && Schema::hasTable('v2_analytics_page'); }
    public function sourcesReady(): bool { return Schema::hasColumn('v2_analytics_session', 'attribution_version'); }
    public function browsersReady(): bool { return Schema::hasColumn('v2_analytics_session','browser_major') && Schema::hasColumn('v2_analytics_session','embedded'); }
    public function save(array $values): array {
        abort_unless($this->ready(),409,'请先执行数据库迁移，再开启访问统计。');
        DB::transaction(function () use ($values) {
            if ($values['enabled']) RiskSetting::firstOrCreate(['key'=>'analytics_started_at'],['value'=>(string)time()]);
            RiskSetting::updateOrCreate(['key'=>'analytics_enabled'],['value'=>$values['enabled'] ? '1' : '0']);
            RiskSetting::updateOrCreate(['key'=>'analytics_retention_days'],['value'=>(string)$values['retentionDays']]);
        });
        Cache::forget('PRODUCT_ANALYTICS_SETTINGS');
        return $this->settings();
    }
    public function record(array $event, ?string $userAgent = null): void {
        if (!$this->settings()['enabled']) return;
        $now = time();
        // No IP, user ID, raw UA, full referrer or URL is persisted. Hash is scoped to this deployment.
        $hash = hash_hmac('sha256', $event['sessionId'], (string)config('app.key'));
        DB::transaction(function () use ($event, $now, $hash, $userAgent) {
            $attribution = $this->browsersReady() ? BrowserAccess::classify($userAgent) : [];
            if ($this->sourcesReady() && (int)($event['attributionVersion'] ?? 0) === 1) {
                $attribution += ['attribution_version'=>1,'source_domain'=>$event['sourceDomain'] ?? null];
            }
            // Attribution is fixed on first insert; later events cannot overwrite it.
            DB::table('v2_analytics_session')->insertOrIgnore(array_merge(['session_hash'=>$hash,'created_at'=>$now,'last_at'=>$now,'device'=>$event['device'],'language'=>$event['language'],'stage'=>0], $attribution));
            $session = DB::table('v2_analytics_session')->where('session_hash',$hash)->lockForUpdate()->first();
            // A browser identifier cannot extend a session indefinitely.
            if ($now-(int)$session->last_at > 1800 || $now-(int)$session->created_at >= 86400) return;
            if (($event['event'] ?? 'view') !== 'view') {
                DB::table('v2_analytics_session')->where('id',$session->id)->update(['last_at'=>$now]);
                app(ExperienceMeasurements::class)->record((int)$session->id,$event);
                return;
            }
            $page = $event['page'];
            $stage = (int)$session->stage;
            $next = ['plan'=>1,'confirmation'=>2,'payment'=>3][$page] ?? 0;
            $changes = ['last_at'=>$now];
            if ($next === $stage+1) {
                $changes['stage']=$next;
            }
            DB::table('v2_analytics_session')->where('id',$session->id)->update($changes);
            $q = DB::table('v2_analytics_page')->where('session_id',$session->id)->where('page',$page);
            if ($q->exists()) $q->where('views','<',1000)->increment('views');
            else DB::table('v2_analytics_page')->insert(['session_id'=>$session->id,'page'=>$page,'views'=>1,'created_at'=>$now]);
        }, 3);
    }
    public function prune(): int {
        if (!$this->ready()) return 0;
        $cutoff = time()-$this->settings()['retentionDays']*86400;
        $ids = DB::table('v2_analytics_session')->where('created_at','<',$cutoff)->orderBy('id')->limit(5000)->pluck('id');
        if ($ids->isEmpty()) return 0;
        return DB::transaction(function () use ($ids) {
            if (app(ExperienceMeasurements::class)->ready()) DB::table('v2_analytics_measurement')->whereIn('session_id',$ids)->delete();
            DB::table('v2_analytics_page')->whereIn('session_id',$ids)->delete();
            return DB::table('v2_analytics_session')->whereIn('id',$ids)->delete();
        });
    }
    public function report(int $days, string $device): array {
        $zone = new \DateTimeZone(TimeZones::system());
        $now = time();
        $end = new \DateTimeImmutable('tomorrow', $zone);
        $start = $end->modify('-'.$days.' days')->getTimestamp();
        $settings=$this->settings();
        $ready=$this->ready();
        $sessions = DB::table('v2_analytics_session')->where('created_at','>=',max($start,$now-$settings['retentionDays']*86400))->where('created_at','<=',$now);
        if ($device!=='all') $sessions->where('device',$device);
        $effectiveStart=max($start,$now-$settings['retentionDays']*86400);
        $started=(int)RiskSetting::where('key','analytics_started_at')->value('value');
        $daily=[]; $previous=null; $sources=[]; $sourceGroups=0; $sourcesReady=$ready && $this->sourcesReady();
        $pages=[]; $funnel=[0,0,0]; $visits=0; $views=0; $devices=[]; $latest=null;
        $hours=array_fill(0,24,0); $weekdays=array_fill(0,7,0);
        if ($ready) {
            // UTC quarter-hour buckets support current half/quarter-hour offsets without MySQL timezone tables.
            $slots=(clone $sessions)->selectRaw('FLOOR(created_at / 900) AS slot, COUNT(*) AS count')->groupBy('slot')->get();
            foreach ($slots as $slot) {
                $local=(new \DateTimeImmutable('@'.((int)$slot->slot*900)))->setTimezone($zone);
                $hours[(int)$local->format('G')]+=(int)$slot->count;
                $weekdays[(int)$local->format('N')-1]+=(int)$slot->count;
            }
            if ($sourcesReady) {
                $grouped=(clone $sessions)->select('attribution_version','source_domain')
                    ->selectRaw('COUNT(*) AS sessions, SUM(CASE WHEN stage>=1 THEN 1 ELSE 0 END) AS plans, SUM(CASE WHEN stage>=2 THEN 1 ELSE 0 END) AS confirmations, SUM(CASE WHEN stage>=3 THEN 1 ELSE 0 END) AS payments')
                    ->groupBy('attribution_version','source_domain');
                $sourceGroups=DB::query()->fromSub(clone $grouped,'groups')->count();
                $sources=(clone $grouped)->orderByDesc('sessions')->orderBy('source_domain')->limit(50)->get()->map(fn($r)=>[
                    'kind'=>(int)$r->attribution_version===0 ? 'historical' : ($r->source_domain ? 'referral' : 'unknown'),
                    'domain'=>$r->source_domain,
                    'sessions'=>(int)$r->sessions,'plans'=>(int)$r->plans,'confirmations'=>(int)$r->confirmations,'payments'=>(int)$r->payments])->all();
            }
            $visits=(clone $sessions)->count();
            $latest=(clone $sessions)->max('last_at');
            $devices=(clone $sessions)->select('device')->selectRaw('COUNT(*) AS sessions')->groupBy('device')->get()->map(fn($r)=>['device'=>$r->device,'sessions'=>(int)$r->sessions])->all();
            $pages=DB::table('v2_analytics_page as p')->joinSub((clone $sessions)->select('id'),'s','s.id','=','p.session_id')
                ->select('page')->selectRaw('SUM(p.views) AS views, COUNT(*) AS sessions')->groupBy('page')->orderByDesc('views')->get()
                ->map(fn($r)=>['page'=>$r->page,'views'=>(int)$r->views,'sessions'=>(int)$r->sessions])->all();
            $views=array_sum(array_column($pages,'views'));
            $counts=(clone $sessions)->selectRaw('SUM(CASE WHEN stage>=1 THEN 1 ELSE 0 END) AS entered, SUM(CASE WHEN stage>=2 THEN 1 ELSE 0 END) AS confirmed, SUM(CASE WHEN stage>=3 THEN 1 ELSE 0 END) AS payment')->first();
            $funnel=[(int)$counts->entered,(int)$counts->confirmed,(int)$counts->payment];
            // Calendar buckets use PHP timezone rules; no dependency on MySQL timezone tables.
            $cursor=$end->modify('-'.$days.' days'); $cases=[]; $bindings=[];
            for ($i=0;$i<$days;$i++) {
                $next=$cursor->modify('+1 day'); $date=$cursor->format('Y-m-d');
                $cases[]='WHEN s.created_at >= ? AND s.created_at < ? THEN ?';
                array_push($bindings,$cursor->getTimestamp(),$next->getTimestamp(),$date);
                $daily[$date]=['date'=>$date,'sessions'=>0,'views'=>0,'available'=>$next->getTimestamp()>$effectiveStart && (!$started || $next->getTimestamp()>$started)];
                $cursor=$next;
            }
            $rows=DB::query()->fromSub((clone $sessions)->select('id','created_at'),'s')
                ->leftJoin('v2_analytics_page as p','p.session_id','=','s.id')
                ->selectRaw('CASE '.implode(' ',$cases).' END AS day', $bindings)
                ->selectRaw('COUNT(DISTINCT s.id) AS sessions, COALESCE(SUM(p.views),0) AS views')->groupBy('day')->get();
            foreach ($rows as $row) if (isset($daily[$row->day])) {
                $daily[$row->day]['sessions']=(int)$row->sessions; $daily[$row->day]['views']=(int)$row->views;
            }
            $previousStart=$end->modify('-'.($days*2).' days')->getTimestamp();
            $previousEnd=(new \DateTimeImmutable('@'.$now))->setTimezone($zone)->modify('-'.$days.' days')->getTimestamp();
            // Do not turn missing retention history into a misleading zero baseline.
            if ($started>0 && $started<=$previousStart && $now-$settings['retentionDays']*86400<=$previousStart) {
                $prior=DB::table('v2_analytics_session')->whereBetween('created_at',[$previousStart,$previousEnd]);
                if ($device!=='all') $prior->where('device',$device);
                $previous=['sessions'=>$prior->count(),'from'=>gmdate('c',$previousStart),'to'=>gmdate('c',$previousEnd)];
            }

        }
        // Cohort includes only registrations with a full seven-day observation window.
        // Orders are authoritative; browser events cannot manufacture a conversion.
        $cohortBoundary=(new \DateTimeImmutable('today',$zone))->modify('-7 days');
        $cohortEnd=$cohortBoundary->getTimestamp();
        $cohortStart=$cohortBoundary->modify('-'.$days.' days')->getTimestamp();
        $cohort=DB::table('v2_user as u')->where('u.is_admin',0)->where('u.created_at','>=',$cohortStart)->where('u.created_at','<',$cohortEnd);
        $registered=(clone $cohort)->count();
        $converted=function(string $stage) use($cohort) {
            return (clone $cohort)->whereExists(function($q) use($stage) {
                $q->selectRaw('1')->from('v2_order as o')->whereColumn('o.user_id','u.id')->where('o.plan_id','>',0)
                    ->whereIn('o.period',['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price','onetime_price'])
                    ->whereColumn('o.created_at','>=','u.created_at')->whereRaw('o.created_at < u.created_at + 604800');
                if ($stage!=='ordered') $q->where('o.paid_at','>',0)->whereRaw('o.paid_at < u.created_at + 604800');
                if ($stage==='completed') $q->whereIn('o.status',[3,4]);
            })->count();
        };
        $browsers=[]; $browsersReady=$ready && $this->browsersReady();
        if ($browsersReady) {
            $browsers=(clone $sessions)->select('browser','browser_major','os','embedded')->selectRaw('COUNT(*) AS sessions')
                ->groupBy('browser','browser_major','os','embedded')->orderByDesc('sessions')->orderBy('browser')->orderBy('browser_major')->orderBy('os')->orderBy('embedded')->limit(100)->get()
                ->map(fn($r)=>['browser'=>$r->browser ?? 'historical','major'=>$r->browser_major===null ? null : (int)$r->browser_major,'os'=>$r->os ?? 'historical','embedded'=>$r->embedded ?? 'historical','sessions'=>(int)$r->sessions])->all();
        }
        return ['browsersReady'=>$browsersReady,'browsers'=>$browsers,'settings'=>$settings,'ready'=>$ready,'timeZone'=>TimeZones::system(),'from'=>gmdate('c',$start),'to'=>gmdate('c',$now),
            'hours'=>$hours,'weekdays'=>$weekdays,'sourcesReady'=>$sourcesReady,'sources'=>$sources,'sourceGroups'=>$sourceGroups,'daily'=>array_values($daily),'previous'=>$previous,'effectiveFrom'=>gmdate('c',max($effectiveStart,$started)),'collectionStartedAt'=>$started ? gmdate('c',$started) : null,
            'latestEventAt'=>$latest ? gmdate('c',$latest) : null,'sessions'=>$visits,'views'=>$views,'pages'=>$pages,'devices'=>$devices,
            'funnel'=>array_map(fn($id,$count)=>['step'=>$id,'sessions'=>$count],['plan','confirmation','payment'],$funnel),
            'cohort'=>['from'=>gmdate('c',$cohortStart),'to'=>gmdate('c',$cohortEnd),'windowDays'=>7,'registered'=>$registered,
                'ordered'=>$converted('ordered'),'paid'=>$converted('paid'),'completed'=>$converted('completed')]];
    }
}
