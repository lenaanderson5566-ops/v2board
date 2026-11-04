<?php
namespace App\Services;

use App\Models\RiskSetting;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class ProductAnalytics {
    public const PAGES = ['landing','register','login','forget','dashboard','plan','confirmation','payment','order','order_detail','activities','coupons','subscribe','knowledge','profile','security','invite','traffic','notifications','ticket','browser_guide','browser_prompt'];
    private const RECURRING_PERIODS = ['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price'];

    private function registrationCohort(int $days, int $now, \DateTimeZone $zone): array {
        // Measure elapsed seconds before rounding to a complete local date. A
        // calendar week can be shorter than 168 hours across a DST transition.
        $boundary=(new \DateTimeImmutable('@'.($now-604800)))->setTimezone($zone)->setTime(0,0,0);
        $end=$boundary->getTimestamp();
        $start=$boundary->modify('-'.$days.' days')->getTimestamp();
        $query=DB::table('v2_user as u')->where('u.is_admin',0)->where('u.created_at','>=',$start)->where('u.created_at','<',$end);
        return [$query,$start,$end];
    }

    private function confirmedOrders(string $alias = 'o') {
        return DB::table('v2_order as '.$alias)->whereIn($alias.'.status',[1,3,4])->where($alias.'.paid_at','>',0);
    }

    private function recurringOrders(string $alias = 'o') {
        return $this->confirmedOrders($alias)->where($alias.'.plan_id','>',0)->where(function($q) use($alias) {
            $q->whereNull($alias.'.credit_bytes')->orWhere($alias.'.credit_bytes',0);
        })
            ->whereIn($alias.'.period',self::RECURRING_PERIODS);
    }

    private function firstPurchase($cohort, int $registered, int $from, int $to): array {
        // A trial may make the first purchase a renewal/switch. Order.type and the
        // current account entitlement cannot establish lifetime purchase history.
        $valued = $this->recurringOrders()->where('o.total_amount','>=',0)->whereRaw('COALESCE(o.balance_amount,0) >= 0')
            ->whereRaw('o.total_amount + COALESCE(o.balance_amount,0) > 0');
        $first = (clone $valued)->whereNotExists(function($prior) {
            $prior->selectRaw('1')->from('v2_order as p')->whereColumn('p.user_id','o.user_id')
                ->whereIn('p.status',[1,3,4])->where('p.paid_at','>',0)->where('p.plan_id','>',0)
                ->where(function($q) { $q->whereNull('p.credit_bytes')->orWhere('p.credit_bytes',0); })
                ->whereIn('p.period',self::RECURRING_PERIODS)->where('p.total_amount','>=',0)->whereRaw('COALESCE(p.balance_amount,0) >= 0')
                ->whereRaw('p.total_amount + COALESCE(p.balance_amount,0) > 0')
                ->where(function($q) { $q->whereColumn('p.paid_at','<','o.paid_at')->orWhere(function($tie) {
                    $tie->whereColumn('p.paid_at','o.paid_at')->whereColumn('p.id','<','o.id');
                }); });
        });
        $first->select('o.user_id','o.paid_at','o.total_amount','o.balance_amount','o.callback_no','o.payment_id');
        $inWindow = (clone $cohort)->joinSub($first,'p','p.user_id','=','u.id')
            ->whereColumn('p.paid_at','>=','u.created_at')->whereRaw('p.paid_at < u.created_at + 604800');
        $method = "CASE WHEN p.callback_no='manual_operation' THEN 'manual'
            WHEN p.total_amount=0 AND COALESCE(p.balance_amount,0)>0 THEN 'walletOnly'
            WHEN p.total_amount>0 AND p.payment_id>0 AND COALESCE(TRIM(p.callback_no),'')<>''
                THEN CASE WHEN COALESCE(p.balance_amount,0)>0 THEN 'mixed' ELSE 'externalOnly' END
            ELSE 'unclassified' END";
        $funding = array_fill_keys(['externalOnly','mixed','walletOnly','manual','unclassified'],0);
        foreach ((clone $inWindow)->selectRaw($method.' AS funding, COUNT(*) AS accounts')->groupBy('funding')->get() as $row) {
            $funding[$row->funding]=(int)$row->accounts;
        }
        $credits = $this->confirmedOrders()->where('o.credit_bytes','>',0)
            ->whereRaw("COALESCE(o.callback_no,'') <> 'manual_operation'")
            ->whereRaw('COALESCE(o.balance_amount,0) >= 0')
            ->whereRaw("((o.total_amount=0 AND COALESCE(o.balance_amount,0)>0)
                OR (o.total_amount>0 AND o.payment_id>0 AND COALESCE(TRIM(o.callback_no),'')<>''))");
        $creditAccounts = (clone $cohort)->whereExists(function($q) use($credits) {
            $q->selectRaw('1')->fromSub($credits->select('o.user_id','o.paid_at'),'p')->whereColumn('p.user_id','u.id')
                ->whereColumn('p.paid_at','>=','u.created_at')->whereRaw('p.paid_at < u.created_at + 604800');
        })->count();
        return ['available'=>true,'from'=>gmdate('c',$from),'to'=>gmdate('c',$to),'windowDays'=>7,'registered'=>$registered,
            'funding'=>$funding,'verifiedRecurringAccounts'=>$funding['externalOnly']+$funding['mixed']+$funding['walletOnly'],
            'verifiedCreditAccounts'=>$creditAccounts];
    }

    public function settings(): array {
        return Cache::remember('PRODUCT_ANALYTICS_SETTINGS', 60, function () {
            $values = RiskSetting::whereIn('key', ['analytics_enabled','analytics_retention_days'])->pluck('value','key');
            $days = (int)($values['analytics_retention_days'] ?? 30);
            return ['enabled'=>($values['analytics_enabled'] ?? '0') === '1', 'retentionDays'=>in_array($days,[7,30,90],true) ? $days : 30];
        });
    }
    public function ready(): bool { return Schema::hasTable('v2_analytics_session'); }
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
    public function record(array $event): void {
        $kind = $event['event'] ?? 'view';
        if (!ExperienceMeasurements::tracks($kind) || !$this->settings()['enabled']) return;
        $now = time();
        // No IP, user ID, raw UA, full referrer or URL is persisted. Hash is scoped to this deployment.
        $hash = hash_hmac('sha256', $event['sessionId'], (string)config('app.key'));
        $columns = Schema::getColumnListing('v2_analytics_session');
        $initial = ['session_hash'=>$hash,'created_at'=>$now,'last_at'=>$now,'device'=>$event['device'],'stage'=>0];
        // Accept legacy payloads without saving their language, including before the retirement migration.
        if (in_array('language', $columns, true)) $initial['language'] = '';
        if (in_array('attribution_version', $columns, true) && in_array('source_domain', $columns, true)
            && (int)($event['attributionVersion'] ?? 0) === 1) {
            $initial += ['attribution_version'=>1,'source_domain'=>$event['sourceDomain'] ?? null];
        }
        DB::transaction(function () use ($event, $kind, $now, $hash, $initial) {
            // Attribution is fixed on first insert; later events cannot overwrite it.
            DB::table('v2_analytics_session')->insertOrIgnore($initial);
            $session = DB::table('v2_analytics_session')->where('session_hash',$hash)->lockForUpdate()->first();
            // A browser identifier cannot extend a session indefinitely.
            if ($now-(int)$session->last_at > 1800 || $now-(int)$session->created_at >= 86400) return;
            if ($kind !== 'view') {
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
        }, 3);
    }
    public function prune(): int {
        if (!$this->ready()) return 0;
        $cutoff = time()-$this->settings()['retentionDays']*86400;
        $ids = DB::table('v2_analytics_session')->where('created_at','<',$cutoff)->orderBy('id')->limit(5000)->pluck('id');
        if ($ids->isEmpty()) return 0;
        return DB::transaction(function () use ($ids) {
            if (app(ExperienceMeasurements::class)->ready()) DB::table('v2_analytics_measurement')->whereIn('session_id',$ids)->delete();
            return DB::table('v2_analytics_session')->whereIn('id',$ids)->delete();
        });
    }
    public function report(int $days, string $device, ?string $view = null): array {
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
        $window = ['settings'=>$settings,'ready'=>$ready,'timeZone'=>$zone->getName(),'from'=>gmdate('c',$start),'to'=>gmdate('c',$now),
            'effectiveFrom'=>gmdate('c',max($effectiveStart,$started)),'collectionStartedAt'=>$started ? gmdate('c',$started) : null];
        if ($view !== 'conversion') {
            $window += $this->dashboardTraffic($sessions, $ready, $end, $days, $now, $effectiveStart, $started, $device, $settings);
        }
        if ($view !== 'traffic') {
            [$cohort,$cohortStart,$cohortEnd]=$this->registrationCohort($days,$now,$zone);
            $window += ['funnel'=>$ready ? $this->visitFunnel($sessions) : [],
                'firstPurchase'=>$this->firstPurchase($cohort,$cohort->count(),$cohortStart,$cohortEnd)];
        }
        return $window;
    }

    private function dashboardTraffic($sessions, bool $ready, \DateTimeImmutable $end, int $days, int $now, int $effectiveStart, int $started, string $device, array $settings): array {
        $daily=$ready ? $this->visitTrend($sessions,$end,$days,$effectiveStart,$started) : [];
        $previous=$ready && $settings['enabled'] ? $this->previousVisits($end,$days,$now,$started,$settings['retentionDays'],$device) : null;
        $sourcesReady=$ready && Schema::hasColumns('v2_analytics_session', ['attribution_version', 'source_domain']);
        $coverage=null; $sources=[];
        if ($sourcesReady) {
            $known="attribution_version > 0 AND source_domain IS NOT NULL AND source_domain <> ''";
            $counts=(clone $sessions)->selectRaw("SUM(CASE WHEN $known THEN 1 ELSE 0 END) AS known,
                SUM(CASE WHEN attribution_version > 0 AND NOT ($known) THEN 1 ELSE 0 END) AS unknown,
                SUM(CASE WHEN attribution_version=0 THEN 1 ELSE 0 END) AS historical")->first();
            $coverage=['known'=>(int)$counts->known,'unknown'=>(int)$counts->unknown,'historical'=>(int)$counts->historical];
            $sources=(clone $sessions)->whereRaw($known)->select('source_domain')
                ->selectRaw('COUNT(*) AS sessions, SUM(CASE WHEN stage>=3 THEN 1 ELSE 0 END) AS payment_entries')
                ->groupBy('source_domain')->orderByDesc('sessions')->orderBy('source_domain')->limit(50)->get()
                ->map(fn($row)=>['domain'=>$row->source_domain,'sessions'=>(int)$row->sessions,'paymentEntries'=>(int)$row->payment_entries])->all();
        }
        return ['sessions'=>array_sum(array_column($daily,'sessions')),'daily'=>$daily,'previous'=>$previous,
            'sourceCoverage'=>$coverage,'sources'=>$sources];
    }

    private function visitFunnel($sessions): array {
        $counts=$sessions ? (clone $sessions)->selectRaw('SUM(CASE WHEN stage>=1 THEN 1 ELSE 0 END) AS entered,
            SUM(CASE WHEN stage>=2 THEN 1 ELSE 0 END) AS confirmed, SUM(CASE WHEN stage>=3 THEN 1 ELSE 0 END) AS payment')->first() : null;
        return [
            ['step'=>'plan','sessions'=>(int)($counts->entered ?? 0)],
            ['step'=>'confirmation','sessions'=>(int)($counts->confirmed ?? 0)],
            ['step'=>'payment','sessions'=>(int)($counts->payment ?? 0)],
        ];
    }

    private function visitTrend($sessions, \DateTimeImmutable $end, int $days, int $effectiveStart, int $started): array {
        // Calendar buckets use PHP timezone rules; no dependency on MySQL timezone tables.
        $cursor=$end->modify('-'.$days.' days'); $daily=[]; $cases=[]; $bindings=[];
        for ($i=0;$i<$days;$i++) {
            $next=$cursor->modify('+1 day'); $date=$cursor->format('Y-m-d');
            $cases[]='WHEN created_at >= ? AND created_at < ? THEN ?';
            array_push($bindings,$cursor->getTimestamp(),$next->getTimestamp(),$date);
            $daily[$date]=['date'=>$date,'sessions'=>0,'available'=>$next->getTimestamp()>$effectiveStart && (!$started || $next->getTimestamp()>$started)];
            $cursor=$next;
        }
        $rows=(clone $sessions)->selectRaw('CASE '.implode(' ',$cases).' END AS day, COUNT(*) AS sessions',$bindings)
            ->groupBy('day')->get();
        foreach ($rows as $row) if (isset($daily[$row->day])) {
            $daily[$row->day]['sessions']=(int)$row->sessions;
        }
        return array_values($daily);
    }

    private function previousVisits(\DateTimeImmutable $end, int $days, int $now, int $started, int $retentionDays, string $device): ?array {
        $previousStart=$end->modify('-'.($days*2).' days')->getTimestamp();
        $previousEnd=(new \DateTimeImmutable('@'.$now))->setTimezone($end->getTimezone())->modify('-'.$days.' days')->getTimestamp();
        // Do not turn missing retention history into a misleading zero baseline.
        if (!$started || $started>$previousStart || $now-$retentionDays*86400>$previousStart) return null;
        $prior=DB::table('v2_analytics_session')->whereBetween('created_at',[$previousStart,$previousEnd]);
        if ($device!=='all') $prior->where('device',$device);
        return ['sessions'=>$prior->count(),'from'=>gmdate('c',$previousStart),'to'=>gmdate('c',$previousEnd)];
    }
}
