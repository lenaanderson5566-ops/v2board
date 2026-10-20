<?php
namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Laravel\Horizon\Contracts\JobRepository;
use Laravel\Horizon\Contracts\WorkloadRepository;

final class ObservabilityMonitor
{
    public const SNAPSHOT = 'observability:monitor:v1';
    public const ALERTS = 'observability:alerts:v1';

    public function inspect(): array
    {
        $health=app(SystemHealthService::class)->inspect();
        try {
            $queue=['available'=>true,'items'=>collect(app(WorkloadRepository::class)->get())->map(fn($row)=>[
                'name'=>(string)($row['name'] ?? 'unknown'),'length'=>(int)($row['length'] ?? 0),
                'wait'=>(float)($row['wait'] ?? 0),'processes'=>(int)($row['processes'] ?? 0)])->values()->all(),
                'failedJobs'=>(int)app(JobRepository::class)->countRecentlyFailed()];
        } catch (\Throwable $error) {$queue=['available'=>false,'items'=>[],'failedJobs'=>null];}
        $metrics=app(RequestPerformance::class)->summary();
        $settings=app(ObservabilitySettings::class)->get();
        $snapshot=['checkedAt'=>time(),'health'=>$health,'queue'=>$queue];
        $conditions=self::conditions($snapshot,$metrics,$settings);
        $alerts=self::advance(Cache::get(self::ALERTS,[]),$conditions,time());
        Cache::put(self::ALERTS,$alerts,604800);
        Cache::put(self::SNAPSHOT,$snapshot,604800);
        return $snapshot+['alerts'=>array_values($alerts)];
    }

    public static function conditions(array $snapshot,array $metrics,array $settings): array
    {
        $conditions=[];
        foreach ($snapshot['health']['checks'] as $check) if ($check['status']!=='healthy') {
            $conditions['health:'.$check['key']]=['label'=>$check['label'],'message'=>$check['message'],'severity'=>$check['status']==='error' ? 'critical' : 'warning'];
        }
        $queue=$snapshot['queue'];
        if (!$queue['available']) $conditions['queue:probe']=['label'=>'队列检查','message'=>'无法读取队列工作负载，请检查 Horizon 与 Redis。','severity'=>'critical'];
        else {
            $length=array_sum(array_column($queue['items'],'length'));
            $wait=max(array_merge([0],array_column($queue['items'],'wait')));
            if ($length >= $settings['queue_length'] || $wait >= $settings['queue_wait_seconds'])
                $conditions['queue:backlog']=['label'=>'队列积压','message'=>"等待任务 {$length} 个，最长等待 {$wait} 秒。",'severity'=>'warning'];
            if ($queue['failedJobs'] >= $settings['failed_jobs'])
                $conditions['queue:failed']=['label'=>'任务失败','message'=>"Horizon 保留窗口内有 {$queue['failedJobs']} 个失败任务，请到队列监控排查。",'severity'=>'critical'];
        }
        $total=$metrics['total'];
        if ($total['samples'] >= $settings['min_samples']) {
            if ($total['errorPercent'] >= $settings['error_percent'])
                $conditions['requests:errors']=['label'=>'接口错误率','message'=>"近 15 分钟样本中 5xx 比例 {$total['errorPercent']}%。",'severity'=>'critical'];
            if (100*$total['slowRequests']/$total['samples'] >= $settings['slow_percent'])
                $conditions['requests:slow']=['label'=>'接口响应缓慢','message'=>"近 15 分钟有 {$total['slowRequests']} 个慢请求样本。",'severity'=>'warning'];
            if ($total['slowQueries'] > 0)
                $conditions['queries:slow']=['label'=>'慢查询','message'=>"近 15 分钟请求样本内发现 {$total['slowQueries']} 次慢查询，请按接口定位。",'severity'=>'warning'];
        }
        return $conditions;
    }

    /** Two consecutive probes to fire/recover; a stale gap starts a new streak. */
    public static function advance(array $previous,array $conditions,int $now): array
    {
        $result=[];
        foreach (array_unique(array_merge(array_keys($previous),array_keys($conditions))) as $key) {
            $old=$previous[$key] ?? null;$condition=$conditions[$key] ?? null;$active=$condition!==null;
            if ($old && intdiv($old['lastCheckedAt'],60)===intdiv($now,60)) {
                $result[$key]=$old;
                continue;
            }
            $same=$old && $old['conditionActive']===$active && $now-$old['lastCheckedAt']<=180;
            $streak=$same ? $old['streak']+1 : 1;
            $state=$old['state'] ?? 'pending';
            if ($active && $streak>=2) $state='firing';
            if (!$active && $streak>=2) $state='resolved';
            if (!$active && $state==='pending') continue;
            $item=($condition ?? array_intersect_key($old,array_flip(['label','message','severity'])))+[
                'key'=>$key,'state'=>$state,'conditionActive'=>$active,'streak'=>min(1000,$streak),
                'firstSeenAt'=>$old['firstSeenAt'] ?? $now,'lastCheckedAt'=>$now,
                'resolvedAt'=>$state==='resolved' ? ($old['resolvedAt'] ?? $now) : null];
            if ($active && ($old['state'] ?? '')==='resolved') {$item['firstSeenAt']=$now;$item['resolvedAt']=null;$item['state']=$streak>=2 ? 'firing' : 'pending';}
            if ($state==='resolved' && $now-($item['resolvedAt'] ?? $now)>86400) continue;
            $result[$key]=$item;
        }
        return array_slice($result,0,50,true);
    }

    public function report(): array
    {
        $snapshot=Cache::get(self::SNAPSHOT);
        $alerts=array_values(Cache::get(self::ALERTS,[]));
        $stale=!$snapshot || time()-$snapshot['checkedAt']>180;
        return ['snapshot'=>$snapshot,'stale'=>$stale,'alerts'=>$alerts,
            'metrics'=>app(RequestPerformance::class)->summary(),'settings'=>app(ObservabilitySettings::class)->get(),
            'assets'=>$this->assets(),'now'=>time()];
    }

    private function assets(): ?array
    {
        $path=public_path('console/build-metrics.json');
        if (!is_file($path) || filesize($path)>262144) return null;
        return json_decode(file_get_contents($path),true);
    }
}
