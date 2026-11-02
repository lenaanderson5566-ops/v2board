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
        $accounts = array_sum($funding);
        $observed = function($orders) use($cohort) {
            return (clone $cohort)->whereExists(function($q) use($orders) {
                $q->selectRaw('1')->fromSub($orders->select('o.user_id','o.paid_at'),'p')->whereColumn('p.user_id','u.id')
                    ->whereColumn('p.paid_at','>=','u.created_at')->whereRaw('p.paid_at < u.created_at + 604800');
            })->count();
        };
        $withoutNewPayment = $this->recurringOrders()->where('o.total_amount',0)->whereRaw('COALESCE(o.balance_amount,0)=0');
        $entitlementCredit = 'COALESCE(o.surplus_amount,0)-COALESCE(o.refund_amount,0)';
        return ['available'=>true,'from'=>gmdate('c',$from),'to'=>gmdate('c',$to),'windowDays'=>7,'registered'=>$registered,
            'paidRecurringAccounts'=>$accounts,'paidRecurringRate'=>OperationsAnalytics::rate($accounts,$registered),'funding'=>$funding,
            'zeroValueRecurringAccounts'=>$observed((clone $withoutNewPayment)->whereRaw($entitlementCredit.' <= 0')),
            'creditOnlyRecurringAccounts'=>$observed((clone $withoutNewPayment)->whereRaw($entitlementCredit.' > 0')),
            'otherPurchases'=>[
                'depositAccounts'=>$observed($this->confirmedOrders()->where('o.period','deposit')),
                'independentCreditAccounts'=>$observed($this->confirmedOrders()->where('o.credit_bytes','>',0)),
                'resetAccounts'=>$observed($this->confirmedOrders()->where('o.period','reset_price')),
                'legacyOneTimeAccounts'=>$observed($this->confirmedOrders()->where('o.plan_id','>',0)
                    ->where(function($q) { $q->whereNull('o.credit_bytes')->orWhere('o.credit_bytes',0); })->where('o.period','onetime_price')),
            ]];
    }

    private function receipts(int $from, int $to): array {
        $paid = $this->confirmedOrders()->where('o.paid_at','>=',$from)->where('o.paid_at','<=',$to);
        $manual = "COALESCE(o.callback_no,'')='manual_operation'";
        $counts = (clone $paid)->selectRaw("SUM(CASE WHEN $manual THEN 1 ELSE 0 END) AS manual,
            SUM(CASE WHEN NOT ($manual) AND o.total_amount=0 AND COALESCE(o.balance_amount,0)>0 THEN 1 ELSE 0 END) AS wallet,
            SUM(CASE WHEN NOT ($manual) AND o.total_amount=0 AND COALESCE(o.balance_amount,0)=0 THEN 1 ELSE 0 END) AS zero,
            SUM(CASE WHEN NOT ($manual) AND o.total_amount>0 THEN 1 ELSE 0 END) AS external")->first();
        $available = Schema::hasColumn('v2_order','payment_snapshot');
        $report = ['available'=>$available,'from'=>gmdate('c',$from),'to'=>gmdate('c',$to),'complete'=>false,'byCurrency'=>[],
            'unresolvedExternalOrders'=>(int)$counts->external,'manualOrders'=>(int)$counts->manual,'walletOnlyOrders'=>(int)$counts->wallet,'zeroExternalOrders'=>(int)$counts->zero,
            // refund_amount is an entitlement exchange returned to a wallet. It is
            // not a provider refund ledger; there is no settlement or fee ledger.
            'refundAmount'=>null,'providerFeeAmount'=>null,'netAmount'=>null,'settlementAmount'=>null];
        if (!$available) return $report;
        $sqlite = DB::connection()->getDriverName()==='sqlite';
        $extract = fn($key) => $sqlite ? "json_extract(o.payment_snapshot,'$.".$key."')" : "JSON_UNQUOTE(JSON_EXTRACT(o.payment_snapshot,'$.".$key."'))";
        $type = fn($key) => $sqlite ? "json_type(o.payment_snapshot,'$.".$key."')" : "LOWER(JSON_TYPE(JSON_EXTRACT(o.payment_snapshot,'$.".$key."')))";
        $amount=$extract('payment_amount'); $currency=$extract('payment_currency');
        // A checkout quote is not a receipt. Only a positive externally-confirmed
        // order with the flat, settled immutable snapshot has known currency/amount.
        // Missing legacy snapshots remain explicitly unresolved, never FX-estimated.
        $valid = "CASE WHEN JSON_VALID(o.payment_snapshot) THEN ".$type('payment_amount')."='integer' AND $amount>0
            AND ".$type('payment_currency')."='text' AND $currency IN ('CNY','USD')
            AND ".$type('provider')."='text' AND ".$extract('provider')."<>''
            AND ".$type('uuid')."='text' AND ".$extract('uuid')."<>''
            AND ".$extract('channels')." IS NULL ELSE 0 END";
        if (!$sqlite) $valid = str_replace("='text'","='string'",$valid);
        $kind = "CASE WHEN o.period='deposit' THEN 'deposit'
            WHEN o.credit_bytes>0 THEN 'independentCredits'
            WHEN o.period='reset_price' THEN 'reset'
            WHEN o.plan_id>0 AND COALESCE(o.credit_bytes,0)=0 AND o.period IN ('".implode("','",self::RECURRING_PERIODS)."') THEN 'recurring'
            WHEN o.plan_id>0 AND COALESCE(o.credit_bytes,0)=0 AND o.period='onetime_price' THEN 'legacyOneTime' ELSE 'other' END";
        $known = (clone $paid)->where('o.total_amount','>',0)->where('o.payment_id','>',0)
            ->whereRaw("NOT ($manual) AND COALESCE(TRIM(o.callback_no),'')<>''")->whereRaw($valid)
            ->selectRaw("$currency AS receipt_currency, $kind AS kind, $amount AS amount");
        $groups=DB::query()->fromSub($known,'receipts')->select('receipt_currency','kind')->selectRaw('COUNT(*) AS orders, SUM(amount) AS amount')
            ->groupBy('receipt_currency','kind')->orderBy('receipt_currency')->orderBy('kind')->get();
        $currencies=[]; $resolved=0;
        foreach ($groups as $row) {
            $currencies[$row->receipt_currency] ??= ['currency'=>$row->receipt_currency,'grossAmount'=>0,'orders'=>0,'kinds'=>[]];
            $currencies[$row->receipt_currency]['grossAmount']+=(int)$row->amount;
            $currencies[$row->receipt_currency]['orders']+=(int)$row->orders;
            $currencies[$row->receipt_currency]['kinds'][]=['kind'=>$row->kind,'grossAmount'=>(int)$row->amount,'orders'=>(int)$row->orders];
            $resolved+=(int)$row->orders;
        }
        $report['byCurrency']=array_values($currencies);
        $report['unresolvedExternalOrders']-=$resolved;
        $report['complete']=$report['unresolvedExternalOrders']===0;
        return $report;
    }
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
        [$cohort,$cohortStart,$cohortEnd]=$this->registrationCohort($days,$now,$zone);
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
            'firstPurchase'=>$this->firstPurchase($cohort,$registered,$cohortStart,$cohortEnd),
            'receipts'=>$this->receipts($start,$now),
            'cohort'=>['from'=>gmdate('c',$cohortStart),'to'=>gmdate('c',$cohortEnd),'windowDays'=>7,'registered'=>$registered,
                'ordered'=>$converted('ordered'),'paid'=>$converted('paid'),'completed'=>$converted('completed')]];
    }
}
