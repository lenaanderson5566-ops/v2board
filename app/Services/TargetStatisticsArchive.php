<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Persist immutable five-minute snapshots; never write SQL on node ingestion. */
final class TargetStatisticsArchive {
    public const TABLE = 'v2_node_target_snapshot';
    public function __construct(private TargetStatisticsStore $store) {}
    public function ready(): bool { return Schema::hasTable(self::TABLE); }
    public function budget(): int { return max(64,min(4096,(int)config('cache.target_statistics_database_budget_mb',256)))*1048576; }
    public function prune(int $hours): int {
        // Small ordered batches keep cleanup transactions bounded.
        $ids=DB::table(self::TABLE)->where('expires_at','<=',time())->orderBy('expires_at')->limit(1000)->pluck('id');
        return $ids->isEmpty() ? 0 : DB::table(self::TABLE)->whereIn('id',$ids)->delete();
    }
    public function shorten(int $hours): void {
        if (!$this->ready()) return;
        DB::table(self::TABLE)->select('id')->whereRaw('expires_at > bucket_at + ?',[$hours*3600])->chunkById(500,function($rows)use($hours){DB::table(self::TABLE)->whereIn('id',$rows->pluck('id'))->update(['expires_at'=>DB::raw('bucket_at + '.($hours*3600))]);},'id');
        $this->prune($hours);
    }
    public function flush(): array {
        if (!$this->ready()) return ['ready'=>false];
        return $this->store->repository()->lock('archive-flush',120)->block(1,function(){
            $policy=app(TargetStatistics::class)->policy();
            $daily=app(TargetStatisticsDaily::class); $dailyReady=$daily->ready();
            if($dailyReady){$daily->runCleanup();$daily->prune($policy['dailyRetentionDays']);}
            $dailyRows=$dailyReady ? DB::table(TargetStatisticsDaily::TABLE)->count() : 0;
            $initialRemaining=$dailyReady ? max(0,$daily->limit()-$dailyRows) : 0; $remaining=$initialRemaining;
            $pruned=$this->prune($policy['retentionHours']);
            $size=DB::table(self::TABLE)->selectRaw('COALESCE(SUM(payload_bytes),0) AS bytes, COUNT(*) AS rows_count')->first();
            $used=(int)$size->bytes; $count=(int)$size->rows_count; $saved=0; $full=false;
            $prefix=$this->store->prefix(); $current=intdiv(time(),300)*300;
            // Leave a five-minute settling interval before treating a bucket as immutable.
            // The index has at most MAX_CONTAINERS entries, never scan unrelated Redis keys.
            $keys=$policy['enabled'] ? $this->store->connection()->zrangebyscore($prefix.'expiry',time(),'+inf') : [];
            $inspected=0;
            foreach($keys as $key) {
                if ($saved>=48 || $inspected>=96) break;
                if (!preg_match('/:(\d+):(\d+)$/D',$key,$m) || (int)$m[2]>$current-600) continue;
                $bucket=(int)$m[2]; $node=(int)$m[1];
                // Lua ledger members contain the connection prefix; rebuild the logical key before a client command.
                $key=$prefix.$node.':'.$bucket;
                $inspected++;
                $value=$this->store->connection()->hgetall($key);
                if (!$value || !isset($value['_version'])) continue;
                $expires=$bucket+$policy['retentionHours']*3600;
                if ($expires<=time() || $value['_version']!==$policy['version']) {
                    $this->store->connection()->eval(self::RELEASE,4,$key,$prefix.'sizes',$prefix.'expiry',$prefix.'used',$value['_version']);
                    continue;
                }
                $payload=json_encode($value,JSON_THROW_ON_ERROR); $bytes=strlen($payload);
                $id=hash('sha256',$node.'|'.$bucket.'|'.$value['_version']);
                $existing=DB::table(self::TABLE)->where('id',$id)->first(['payload_bytes','expires_at','daily_archived']);
                if ($used-($existing->payload_bytes??0)+$bytes>$this->budget() || (!$existing && $count>=50000)) { $full=true;break; }
                // Upsert snapshots replaces counters, never adds them. Crash retries are idempotent.
                DB::transaction(function()use($id,$node,$value,$bucket,$expires,$existing,$bytes,$payload,$dailyReady,$daily,$policy,&$remaining){
                DB::table(self::TABLE)->upsert([['id'=>$id,'node_id'=>$node,'version'=>$value['_version'],'bucket_at'=>$bucket,'expires_at'=>min($expires,$existing->expires_at??$expires),'payload_bytes'=>$bytes,'payload'=>$payload]],['id'],['payload','payload_bytes','expires_at']);
                    if($dailyReady && !($existing->daily_archived??false)) {
                        $daily->add($node,$bucket,$value,$policy['dailyRetentionDays'],$remaining);
                        DB::table(self::TABLE)->where('id',$id)->update(['daily_archived'=>true]);
                    }
                });
                $used=$used-($existing->payload_bytes??0)+$bytes; if(!$existing)$count++;
                // Release Redis only after SQL succeeds. Keep batch deduplication independent.
                $this->store->connection()->eval(self::RELEASE,4,$key,$prefix.'sizes',$prefix.'expiry',$prefix.'used',$value['_version']);
                $saved++;
            }
            if($dailyReady)$this->store->repository()->put('daily-row-count',$dailyRows+$initialRemaining-$remaining,60);
            $result=['ready'=>true,'at'=>time(),'savedBuckets'=>$saved,'prunedBuckets'=>$pruned,'usedBytes'=>$used,'budgetBytes'=>$this->budget(),'full'=>$full];
            $this->store->repository()->put('archive-status',$result,300);
            return $result;
        });
    }
    public function status(): array {
        return ($this->store->repository()->get('archive-status') ?? []) + ['ready'=>$this->ready(),'budgetBytes'=>$this->budget(),'at'=>null];
    }
    private const RELEASE = <<<'LUA'
if redis.call('HGET',KEYS[1],'_version') ~= ARGV[1] then return 0 end
local cost=tonumber(redis.call('HGET',KEYS[2],KEYS[1]) or '0')
redis.call('DEL',KEYS[1]);redis.call('HDEL',KEYS[2],KEYS[1]);redis.call('ZREM',KEYS[3],KEYS[1])
local used=math.max(0,tonumber(redis.call('GET',KEYS[4]) or '0')-cost)
redis.call('SET',KEYS[4],used,'EX',90000)
return 1
LUA;
}
