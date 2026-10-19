<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class JourneyAnalytics
{
    private const PERIODS=['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price','onetime_price'];

    /** Calendar cohorts: only accounts whose entire observation window has elapsed. */
    private function cohort(int $days, int $window, \DateTimeImmutable $today)
    {
        $end=$today->modify('-'.($window-1).' days');
        $start=$end->modify('-'.$days.' days');
        $cases=[]; $bindings=[]; $ends=[]; $endBindings=[];
        for ($day=$start; $day<$end; $day=$day->modify('+1 day')) {
            $next=$day->modify('+1 day');
            $cases[]='WHEN created_at >= ? AND created_at < ? THEN ?';
            array_push($bindings,$day->getTimestamp(),$next->getTimestamp(),$day->getTimestamp());
            $ends[]='WHEN created_at >= ? AND created_at < ? THEN ?';
            array_push($endBindings,$day->getTimestamp(),$next->getTimestamp(),$day->modify('+'.$window.' days')->getTimestamp());
        }
        $accounts=DB::table('v2_user')->where('is_admin',0)->where('created_at','>=',$start->getTimestamp())->where('created_at','<',$end->getTimestamp())
            ->select('id','created_at')->selectRaw('CASE '.implode(' ',$cases).' END AS day_start',$bindings)
            ->selectRaw('CASE '.implode(' ',$ends).' END AS window_end',$endBindings);
        return [DB::query()->fromSub($accounts,'u'),$start,$end];
    }

    private function planOrders()
    {
        return DB::table('v2_order')->where('plan_id','>',0)->whereIn('period',self::PERIODS)->where('paid_at','>',0);
    }

    public function report(int $days): array
    {
        $now=time(); $zone=new \DateTimeZone(TimeZones::system()); $today=new \DateTimeImmutable('today',$zone);
        $login=Schema::hasTable('v2_login_log'); $subscription=Schema::hasTable('v2_subscribe_log'); $usage=Schema::hasTable('v2_stat_user');
        [$cohort,$start,$end]=$this->cohort($days,7,$today);
        $paid=$this->planOrders()->select('user_id')->selectRaw('MIN(paid_at) AS first_paid')->groupBy('user_id');
        $base=(clone $cohort)->leftJoinSub($paid,'p','p.user_id','=','u.id');
        $paidInWindow='p.first_paid >= u.created_at AND p.first_paid < u.window_end';
        $sub=$subscription ? "(SELECT MIN(s.created_at) FROM v2_subscribe_log s WHERE s.user_id=u.id AND s.status='success' AND s.created_at>=p.first_paid AND s.created_at<u.window_end)" : 'NULL';
        $activation=(clone $base)->selectRaw("COUNT(*) AS registered,
            SUM(CASE WHEN $paidInWindow THEN 1 ELSE 0 END) AS paid,
            SUM(CASE WHEN $paidInWindow AND $sub IS NOT NULL THEN 1 ELSE 0 END) AS subscribed,
            AVG(CASE WHEN $paidInWindow THEN p.first_paid-u.created_at ELSE NULL END) AS paid_wait,
            AVG(CASE WHEN $paidInWindow THEN $sub-p.first_paid ELSE NULL END) AS subscribe_wait")->first();
        $used=null;
        if ($subscription && $usage) {
            $used=(clone $base)->whereRaw($paidInWindow)->whereRaw("$sub IS NOT NULL")->whereExists(function($q) {
                $q->selectRaw('1')->from('v2_stat_user as t')->whereColumn('t.user_id','u.id')->where('t.record_type','d')
                    ->where(function($q){$q->where('t.u','>',0)->orWhere('t.d','>',0);})
                    ->whereColumn('t.record_at','>=','u.day_start')->whereColumn('t.record_at','<','u.window_end');
            })->count();
        }
        $retention=[];
        foreach ([7,30] as $window) {
            [$q,$from,$to]=$this->cohort($days,$window,$today);
            // Last calendar day of the observation window. DST may make this day 23/25 hours;
            // use an explicit per-date CASE rather than subtracting 86400 seconds.
            $cases=[]; $bindings=[];
            for ($day=$from; $day<$to; $day=$day->modify('+1 day')) {
                $cases[]='WHEN u.day_start = ? THEN ?'; array_push($bindings,$day->getTimestamp(),$day->modify('+'.($window-1).' days')->getTimestamp());
            }
            $lastDay='(CASE '.implode(' ',$cases).' END)';
            $count=(clone $q)->count(); $loginCount=null; $usageCount=null;
            if ($login) $loginCount=(clone $q)->whereExists(function($s) use($lastDay,$bindings) {
                $s->selectRaw('1')->from('v2_login_log as l')->whereColumn('l.user_id','u.id')->where('l.is_success',1)
                    ->whereRaw('l.created_at >= '.$lastDay,$bindings)->whereColumn('l.created_at','<','u.window_end');
            })->count();
            if ($usage) $usageCount=(clone $q)->whereExists(function($s) use($lastDay,$bindings) {
                $s->selectRaw('1')->from('v2_stat_user as t')->whereColumn('t.user_id','u.id')->where('t.record_type','d')
                    ->where(function($s){$s->where('t.u','>',0)->orWhere('t.d','>',0);})
                    ->whereRaw('t.record_at >= '.$lastDay,$bindings)->whereColumn('t.record_at','<','u.window_end');
            })->count();
            $retention[]=['day'=>$window,'from'=>gmdate('c',$from->getTimestamp()),'to'=>gmdate('c',$to->getTimestamp()),'registered'=>$count,
                'login'=>$loginCount,'usage'=>$usageCount,'loginRate'=>$loginCount===null ? null : OperationsAnalytics::rate($loginCount,$count),
                'usageRate'=>$usageCount===null ? null : OperationsAnalytics::rate($usageCount,$count)];
        }
        $active=[];
        foreach ([1,7,30] as $window) {
            $since=$today->modify('-'.($window-1).' days')->getTimestamp();
            $accounts=DB::table('v2_user')->where('is_admin',0);
            $logged=$login ? (clone $accounts)->whereExists(fn($q)=>$q->selectRaw('1')->from('v2_login_log as l')->whereColumn('l.user_id','v2_user.id')->where('l.is_success',1)->whereBetween('l.created_at',[$since,$now]))->count() : null;
            $usedNow=$usage ? (clone $accounts)->whereExists(fn($q)=>$q->selectRaw('1')->from('v2_stat_user as t')->whereColumn('t.user_id','v2_user.id')->where('t.record_type','d')->whereBetween('t.record_at',[$since,$now])->where(fn($q)=>$q->where('t.u','>',0)->orWhere('t.d','>',0)))->count() : null;
            $active[]=['days'=>$window,'login'=>$logged,'usage'=>$usedNow];
        }
        // Repurchase measures a fully observed first-payment cohort, not historical expiry churn.
        $repurchaseStart=$today->modify('-'.($days+30).' days')->getTimestamp(); $repurchaseEnd=$today->modify('-30 days')->getTimestamp();
        $first=(clone $paid)->where('total_amount','>',0);
        $repurchase=DB::query()->fromSub($first,'p')->join('v2_user as u','u.id','=','p.user_id')->where('u.is_admin',0)
            ->where('p.first_paid','>=',$repurchaseStart)->where('p.first_paid','<',$repurchaseEnd);
        $eligible=(clone $repurchase)->count();
        $renewed=(clone $repurchase)->whereExists(function($q) {
            $q->selectRaw('1')->from('v2_order as r')->whereColumn('r.user_id','u.id')->where('r.type',2)->where('r.plan_id','>',0)
                ->whereIn('r.period',self::PERIODS)->where('r.total_amount','>',0)->whereColumn('r.paid_at','>','p.first_paid')->whereRaw('r.paid_at < p.first_paid + 2592000');
        })->count();
        $expiryFrom=$today->modify('-'.($days+6).' days')->getTimestamp();
        $expiryTo=$now-7*86400;
        $expired=DB::table('v2_user')->where('is_admin',0)->whereNotNull('plan_id')->where('expired_at','>=',$expiryFrom)->where('expired_at','<=',$expiryTo)->count();
        return ['generatedAt'=>gmdate('c',$now),'timeZone'=>TimeZones::system(),'retention'=>(new LogRetentionService())->settings(),
            'activation'=>['from'=>gmdate('c',$start->getTimestamp()),'to'=>gmdate('c',$end->getTimestamp()),'registered'=>(int)$activation->registered,'paid'=>(int)$activation->paid,
                'subscribed'=>$subscription ? (int)$activation->subscribed : null,'used'=>$used,
                'averagePaymentSeconds'=>$activation->paid_wait===null ? null : (int)round($activation->paid_wait),
                'averageSubscriptionSeconds'=>$activation->subscribe_wait===null ? null : (int)round($activation->subscribe_wait)],
            'retentionCohorts'=>$retention,'active'=>$active,
            'repurchase'=>['from'=>gmdate('c',$repurchaseStart),'to'=>gmdate('c',$repurchaseEnd),'eligible'=>$eligible,'renewed'=>$renewed,'rate'=>OperationsAnalytics::rate($renewed,$eligible)],
            'expiredUnrestored'=>$expired,'expiryFrom'=>gmdate('c',$expiryFrom),'expiryTo'=>gmdate('c',$expiryTo),'usageEarliestAt'=>$usage && ($earliest=DB::table('v2_stat_user')->where('record_type','d')->min('record_at')) ? gmdate('c',$earliest) : null];
    }
}
