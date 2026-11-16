<?php
namespace App\Services;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
class DashboardUsage
{
    public static function summary(): array
    {
        $zone=TimeZones::system();
        $today=(new \DateTimeImmutable('now',new \DateTimeZone($zone)))->setTime(0,0);
        return Cache::remember('dashboard-usage:v3:'.$zone.':'.$today->getTimestamp(),120,function() use($zone,$today){
            $starts=[$today->getTimestamp(),$today->modify('-6 days')->getTimestamp(),$today->modify('-29 days')->getTimestamp()];
            $end=$today->modify('+1 day')->getTimestamp();
            $query=DB::table('v2_stat_user')->where('record_type','d')->where('record_at','>=',$starts[2])->where('record_at','<',$end)->where(function($q){$q->where('u','>',0)->orWhere('d','>',0);});
            $select=[];$bindings=[];
            foreach($starts as $i=>$start){
                $select[]="COUNT(DISTINCT CASE WHEN record_at >= ? THEN user_id END) AS users_$i";
                $select[]="COALESCE(SUM(CASE WHEN record_at >= ? THEN u + d ELSE 0 END),0) AS bytes_$i";
                array_push($bindings,$start,$start);
            }
            $totals=(clone $query)->selectRaw(implode(',',$select),$bindings)->first();
            $periods=[];
            foreach($starts as $i=>$start) $periods[]=['days'=>[1,7,30][$i],'users'=>(int)$totals->{'users_'.$i},'bytes'=>(int)$totals->{'bytes_'.$i}];
            $daily=(clone $query)->selectRaw('record_at, record_timezone, SUM(u+d) as bytes')
                ->groupBy('record_at', 'record_timezone')->get();
            $series=[];
            foreach($daily as $row){
                $recordZone=TimeZones::valid($row->record_timezone) ? $row->record_timezone : 'Asia/Shanghai';
                $label=(new \DateTimeImmutable('@'.$row->record_at))->setTimezone(new \DateTimeZone($recordZone))->format('Y-m-d');
                $series[$label] ??= ['date'=>$label,'bytes'=>0];
                // Only the original label is restored; the queried buckets and arithmetic stay the same.
                $series[$label]['bytes']+=(int)$row->bytes;
            }
            ksort($series);
            return ['timezone'=>$zone,'generated_at'=>time(),'periods'=>$periods,'daily'=>array_values($series),
                'has_records'=>$daily->isNotEmpty()];
        });
    }
}
