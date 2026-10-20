<?php
namespace App\Services;

use Illuminate\Support\Facades\Cache;

/** Bounded sampled aggregates. No SQL, bindings, URLs, user IDs or request bodies. */
final class RequestPerformance
{
    public const BUCKETS = [50,100,250,500,1000,2000,5000,10000,60000,3600000];
    private bool $active=false;
    private float $started=0;
    private array $queries=[];
    private array $settings=[];

    public function begin(?bool $sample=null): void
    {
        $this->active=false;
        try {
            $this->settings=app(ObservabilitySettings::class)->get();
            $this->active=$sample ?? (random_int(1,100)<=$this->settings['sample_percent']);
            $this->started=microtime(true);
            $this->queries=['count'=>0,'ms'=>0,'slow'=>0,'max'=>0];
        } catch (\Throwable $error) { /* Monitoring must never block application traffic. */ }
    }

    public function query(float $milliseconds): void
    {
        if (!$this->active) return;
        $ms=max(0,$milliseconds);
        $this->queries['count']++;
        $this->queries['ms']+=$ms;
        $this->queries['max']=max($ms,$this->queries['max']);
        if ($ms >= $this->settings['slow_query_ms']) $this->queries['slow']++;
    }

    public function finish($request, int $status): void
    {
        if (!$this->active) return;
        $this->active=false;
        $route=$request->route();
        $label=$route ? ($route->getName() ?: $route->uri()) : 'unmatched';
        if ($route && !str_starts_with($route->uri(),'api/')) {
            if (str_contains($route->getActionName(),'CustomSubscriptionController')) $label='custom-subscription';
            else return;
        }
        if (str_contains($label,'system/observability')) return;
        $admin=config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
        $label=str_replace('api/v1/'.$admin.'/','admin/',$label);
        $label=str_replace('api/v1/'.config('v2board.ops_api_path','ops').'/','ops/',$label);
        $method=in_array($request->method(),['GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'],true) ? $request->method() : 'OTHER';
        $this->record($method.' '.substr($label,0,180),$status,(microtime(true)-$this->started)*1000,$this->queries,$this->settings['slow_request_ms']);
    }

    public function record(string $route, int $status, float $duration, array $queries, int $slowThreshold, ?int $now=null): void
    {
        $minute=intdiv($now ?? time(),60);
        try {
            $key=$this->prefix().$minute;
            $lock=Cache::lock($key.':lock',3);
            if (!$lock->get()) {
                Cache::add($key.':dropped',0,3900);Cache::increment($key.':dropped');return;
            }
            try {
                $rows=Cache::get($key,[]);
                if (!isset($rows[$route]) && count($rows)>=128) $route='OTHER ROUTES';
                $row=$rows[$route] ?? self::emptyRow();
                $duration=max(0,min(3600000,$duration));
                $row['samples']++;$row['errors']+=(int)($status>=500);
                $row['durationMs']+=round($duration,2);$row['maxMs']=max($duration,$row['maxMs']);
                $row['slowRequests']+=(int)($duration >= $slowThreshold);
                $row['queries']+=(int)$queries['count'];$row['queryMs']+=round($queries['ms'],2);
                $row['slowQueries']+=(int)$queries['slow'];$row['maxQueryMs']=max($row['maxQueryMs'],$queries['max']);
                foreach (self::BUCKETS as $index=>$upper) if ($duration<=$upper) {$row['histogram'][$index]++;break;}
                $rows[$route]=$row;Cache::put($key,$rows,3900);
            } finally {$lock->release();}
        } catch (\Throwable $error) { /* Cache outage cannot fail a business request. */ }
    }

    private function prefix(): string
    {
        return 'observability:minute:v1:'.substr(hash('sha256',json_encode(app(ObservabilitySettings::class)->get())),0,16).':';
    }

    private static function emptyRow(): array
    {
        return ['samples'=>0,'errors'=>0,'durationMs'=>0,'maxMs'=>0,'slowRequests'=>0,
            'queries'=>0,'queryMs'=>0,'slowQueries'=>0,'maxQueryMs'=>0,'histogram'=>array_fill(0,count(self::BUCKETS),0)];
    }

    public function summary(?int $now=null): array
    {
        $minute=intdiv($now ?? time(),60);$keys=[];$routes=[];$dropped=0;$total=self::emptyRow();
        for($i=0;$i<15;$i++) {$keys[]=$this->prefix().($minute-$i);$keys[]=$this->prefix().($minute-$i).':dropped';}
        foreach(Cache::many($keys) as $key=>$rows) {
            if (str_ends_with($key,':dropped')) {$dropped+=(int)$rows;continue;}
            foreach ($rows ?? [] as $route=>$row) {
                if (!isset($routes[$route]) && count($routes)>=128) $route='OTHER ROUTES';
                $routes[$route] ??= self::emptyRow();
                foreach ($row as $field=>$value) {
                    if ($field==='histogram') {foreach ($value as $index=>$count) {$routes[$route][$field][$index]+=$count;$total[$field][$index]+=$count;}}
                    elseif (in_array($field,['maxMs','maxQueryMs'],true)) {$routes[$route][$field]=max($routes[$route][$field],$value);$total[$field]=max($total[$field],$value);}
                    else {$routes[$route][$field]+=$value;$total[$field]+=$value;}
                }
            }
        }
        $result=[];
        foreach ($routes as $route=>$row) $result[]=['route'=>$route]+self::present($row);
        usort($result,fn($a,$b)=>($b['slowRequests']<=>$a['slowRequests']) ?: ($b['maxMs']<=>$a['maxMs']));
        return ['windowMinutes'=>15,'from'=>($minute-14)*60,'to'=>$now ?? time(),'dropped'=>$dropped,
            'total'=>self::present($total),'routes'=>array_slice($result,0,50)];
    }

    private static function present(array $row): array
    {
        $target=(int)ceil($row['samples']*.95);$count=0;$p95=null;
        if ($target) foreach ($row['histogram'] as $index=>$amount) {
            $count+=$amount;if($count>=$target){$p95=self::BUCKETS[$index];break;}
        }
        unset($row['histogram']);
        return $row+['averageMs'=>$row['samples'] ? round($row['durationMs']/$row['samples'],2) : null,
            'p95UpperMs'=>$p95,'errorPercent'=>$row['samples'] ? round(100*$row['errors']/$row['samples'],2) : null];
    }
}
