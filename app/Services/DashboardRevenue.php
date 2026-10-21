<?php

namespace App\Services;

use App\Models\Order;
use Carbon\CarbonImmutable;

class DashboardRevenue
{
    /** Amounts remain order-currency amounts, not gateway settlement or profit. */
    public static function financial(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $month=$now->startOfMonth(); $previous=$month->subMonth();
        $sameEnd=$now->subMonthNoOverflow()->addSecond();
        $query=Order::query()->whereNotIn('status',[0,2])->where('paid_at','>=',$previous->timestamp)->where('paid_at','<=',$now->timestamp)->select('currency')->groupBy('currency');
        foreach(['today'=>[$now->startOfDay(),$now->addSecond()], 'month'=>[$month,$now->addSecond()], 'previous'=>[$previous,$month], 'comparable'=>[$previous,$sameEnd]] as $key=>[$from,$to]) {
            $query->selectRaw("COALESCE(SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN total_amount ELSE 0 END),0) AS {$key}_amount",[$from->timestamp,$to->timestamp]);
            $query->selectRaw("SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN 1 ELSE 0 END) AS {$key}_count",[$from->timestamp,$to->timestamp]);
        }
        foreach(['deposit'=>"period = 'deposit'",'subscription'=>"period <> 'deposit'"] as $key=>$condition) $query->selectRaw("COALESCE(SUM(CASE WHEN paid_at >= ? AND {$condition} THEN total_amount ELSE 0 END),0) AS {$key}_amount",[$month->timestamp]);
        $values=$query->get()->keyBy('currency');
        $commissions=\App\Models\CommissionLog::where('created_at','>=',$month->timestamp)->where('created_at','<=',$now->timestamp)->select('currency')->selectRaw('SUM(get_amount) AS amount')->groupBy('currency')->get()->keyBy('currency');
        $pending=Order::where('commission_status',0)->whereNotNull('invite_user_id')->whereNotIn('status',[0,2])->where('commission_balance','>',0)->select('currency')->selectRaw('SUM(commission_balance) AS amount, COUNT(*) AS count')->groupBy('currency')->get()->keyBy('currency');
        // CASE ranges retain configured timezone boundaries across SQLite and MySQL.
        $case='CASE';
        for($i=29;$i>=0;$i--) { $day=$now->startOfDay()->subDays($i); $case.=" WHEN paid_at >= ".$day->timestamp." AND paid_at < ".$day->addDay()->timestamp." THEN '".$day->format('Y-m-d')."'"; }
        $case.=' END';
        $daily=Order::whereNotIn('status',[0,2])->where('paid_at','>=',$now->startOfDay()->subDays(29)->timestamp)->where('paid_at','<=',$now->timestamp)->select('currency')->selectRaw($case.' AS day')->selectRaw('SUM(total_amount) AS amount, COUNT(*) AS count')->groupBy('currency','day')->orderBy('day')->get();
        return ['timeZone'=>$now->timezoneName,'currencies'=>array_map(function($currency)use($values,$commissions,$pending,$daily,$now){
            $row=$values[$currency]??null; $out=['currency'=>$currency];
            foreach(['today_amount','month_amount','previous_amount','comparable_amount','month_count','deposit_amount','subscription_amount'] as $key)$out[$key]=(int)($row->$key??0);
            $out['average_amount']=$out['month_count'] ? (int)round($out['month_amount']/$out['month_count']):null;
            $out['change_percent']=$out['comparable_amount'] ? round(($out['month_amount']-$out['comparable_amount'])/$out['comparable_amount']*100,1):null;
            $out['commission_paid']=(int)($commissions[$currency]->amount??0); $out['commission_pending']=(int)($pending[$currency]->amount??0); $out['commission_pending_count']=(int)($pending[$currency]->count??0);
            $points=$daily->where('currency',$currency)->keyBy('day');$out['daily']=[];
            for($i=29;$i>=0;$i--) { $date=$now->subDays($i)->format('Y-m-d');$point=$points[$date]??null;$out['daily'][]=['date'=>$date,'amount'=>(int)($point->amount??0),'count'=>(int)($point->count??0)]; }

            return $out;
        },['CNY','USD'])];
    }

    public static function summary(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $year = $now->startOfYear();
        $lastYear = $year->subYear();
        $month = $now->startOfMonth();
        $ranges = [
            'day_income' => [$now->startOfDay(), $now->addSecond()],
            'month_income' => [$month, $now->addSecond()],
            'last_month_income' => [$month->subMonth(), $month],
            'year_income' => [$year, $now->addSecond()],
            'last_year_income' => [$lastYear, $year],
            'last_year_same_period_income' => [$lastYear, $now->subYearNoOverflow()->addSecond()],
        ];
        $query = Order::query()->where('currency','CNY')->whereNotIn('status', [0, 2])
            ->where('paid_at', '>=', $lastYear->timestamp)
            ->where('paid_at', '<=', $now->timestamp);
        foreach ($ranges as $key => [$start, $end]) {
            $query->selectRaw("COALESCE(SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN total_amount ELSE 0 END), 0) AS {$key}", [$start->timestamp, $end->timestamp]);
        }
        $result = $query->first();
        return array_map(fn ($value) => (int) $value, $result->getAttributes());
    }
}
