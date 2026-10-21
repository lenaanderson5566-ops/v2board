<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** UTC daily aggregates contain no user identifiers. Called within snapshot transaction and archive lock. */
final class TargetStatisticsDaily {
    public const TABLE='v2_node_target_daily';
    public const DAYS='v2_node_target_day';
    public function ready(): bool { return Schema::hasTable(self::TABLE) && Schema::hasTable(self::DAYS); }
    public function limit(): int { return max(1000,min(1000000,(int)config('cache.target_statistics_daily_max_rows',200000))); }
    public function prune(int $days): void {
        foreach([self::TABLE,self::DAYS] as $table) {
            $ids=DB::table($table)->where(function($q)use($days){$q->where('expires_at','<=',time())->orWhere('day_at','<',intdiv(time(),86400)*86400-max(0,$days-1)*86400); if(!$days)$q->orWhereRaw('1=1');})->orderBy('expires_at')->limit(1000)->pluck('id');
            if($ids->isNotEmpty()) DB::table($table)->whereIn('id',$ids)->delete();
        }
    }
    public function shorten(int $days): void {
        if(!$this->ready()) return;
        foreach([self::TABLE,self::DAYS] as $table) DB::table($table)->whereRaw('expires_at > day_at + ?',[$days*86400])->update(['expires_at'=>DB::raw('day_at + '.($days*86400))]);
        $this->prune($days);
    }
    public function add(int $node,int $bucket,array $payload,int $days,int &$remaining): void {
        if(!$days) return;
        $day=intdiv($bucket,86400)*86400; $expires=$day+$days*86400;
        if($expires<=time())return;
        $dayId=hash('sha256',$node.'|'.$day);
        $summary=DB::table(self::DAYS)->where('id',$dayId)->first();
        if($summary && $summary->expires_at<=time())$summary=null;
        $count=(int)($summary->target_count??0); $omitted=0;
        $rows=[];
        foreach($payload as $field=>$meta) {
            if(!str_starts_with($field,'m:'))continue;
            $key=substr($field,2); $meta=json_decode($meta,true,512,JSON_THROW_ON_ERROR);
            $id=hash('sha256',$node.'|'.$day.'|'.$meta['type'].'|'.$meta['target']);
            if(!isset($rows[$id]))$rows[$id]=['type'=>$meta['type'],'target'=>$meta['target'],'connections'=>0,'upload_bytes'=>0,'download_bytes'=>0];
            foreach(['connections'=>'c:','upload_bytes'=>'u:','download_bytes'=>'d:'] as $column=>$prefix)$rows[$id][$column]+=(int)($payload[$prefix.$key]??0);
        }
        $existing=DB::table(self::TABLE)->whereIn('id',array_keys($rows))->get()->keyBy('id');
        $writes=[];
        foreach($rows as $id=>$row) {
            $physical=isset($existing[$id]); $old=$existing[$id]??null;
            if($old && $old->expires_at<=time())$old=null;
            if(!$old && ($count>=500 || (!$physical && $remaining<=0))) { $omitted++;continue; }
            if($old) {
                foreach(['connections','upload_bytes','download_bytes'] as $column)$row[$column]+=(int)$old->$column;
            } else { $count++;if(!$physical)$remaining--; }
            $row+=['id'=>$id,'node_id'=>$node,'day_at'=>$day,'expires_at'=>min($expires,$old->expires_at??$expires)];
            $row['total_bytes']=$row['upload_bytes']+$row['download_bytes'];
            $writes[]=$row;
        }
        foreach(array_chunk($writes,80) as $batch) DB::table(self::TABLE)->upsert($batch,['id'],['connections','upload_bytes','download_bytes','total_bytes','expires_at']);
        DB::table(self::DAYS)->updateOrInsert(['id'=>$dayId],['node_id'=>$node,'day_at'=>$day,'expires_at'=>min($expires,$summary->expires_at??$expires),'target_count'=>$count,'omitted'=>(int)($summary->omitted??0)+$omitted,'source_dropped'=>(int)($summary->source_dropped??0)+(int)($payload['_dropped']??0),'last_bucket_at'=>max($bucket,(int)($summary->last_bucket_at??0))]);
    }
    public function report(int $node,int $days,int $page): array {
        $empty=['rows'=>[],'total'=>0,'dropped'=>0,'truncated'=>false,'dailyReady'=>$this->ready(),'dailyMaxRows'=>$this->limit(),'dailyUsedRows'=>0,'availableFrom'=>null,'latestBucketAt'=>null];
        if(!$empty['dailyReady'] || !$days)return $empty;
        $start=intdiv(time(),86400)*86400-($days-1)*86400;
        $query=DB::table(self::TABLE)->where('node_id',$node)->where('day_at','>=',$start)->where('expires_at','>',time());
        $meta=DB::table(self::DAYS)->where('node_id',$node)->where('day_at','>=',$start)->where('expires_at','>',time())->selectRaw('SUM(omitted) AS omitted, SUM(source_dropped) AS dropped, MIN(day_at) AS first_day, MAX(last_bucket_at) AS latest')->first();
        return array_replace($empty,['total'=>(clone $query)->count(),'rows'=>$query->orderByDesc('day_at')->orderByDesc('total_bytes')->orderBy('id')->offset(($page-1)*25)->limit(25)->get()->map(fn($r)=>['date'=>gmdate('Y-m-d',$r->day_at),'type'=>$r->type,'target'=>$r->target,'connections'=>(int)$r->connections,'uploadBytes'=>(int)$r->upload_bytes,'downloadBytes'=>(int)$r->download_bytes])->all(),'truncated'=>(int)$meta->omitted>0,'dropped'=>(int)$meta->dropped,'availableFrom'=>$meta->first_day ? gmdate('Y-m-d',$meta->first_day):null,'latestBucketAt'=>$meta->latest ? gmdate('c',$meta->latest):null,'dailyUsedRows'=>DB::table(self::TABLE)->count()]);
    }
}
