<?php
namespace App\Services;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class ServerTrafficBudgetService {
 public static function budgetId(string $type,int $nodeId,bool $lock=false): ?int {
  if(!in_array($type,['v2node','v2box'],true))return null;
  $node=(new ServerService())->getServer($nodeId,$type);
  $root=$node && $node->service_id ? (int)$node->service_id : $nodeId;
  if($lock)DB::table('v2_server_'.$type)->where('id',$root)->lockForUpdate()->first();
  $query=DB::table('v2_server_traffic_binding')->where('node_type',$type)->where('node_id',$root);
  if($lock)$query->lockForUpdate();
  $id=$query->value('budget_id');
  return $id===null ? null : (int)$id;
 }
 public static function period(int $resetDay,?CarbonImmutable $now=null): array {
  $now=$now ?? CarbonImmutable::now(config('app.timezone','UTC'));
  $start=$now->startOfMonth()->addDays($resetDay-1);
  if($start->greaterThan($now))$start=$start->subMonthNoOverflow();
  return [$start,$start->addMonthNoOverflow()];
 }
 public static function importHistory(int $budgetId,string $type,int $nodeId): void {
  if(!DB::table('v2_server_traffic_import')->insertOrIgnore(['node_type'=>$type,'node_id'=>$nodeId,'budget_id'=>$budgetId]))return;
  $since=CarbonImmutable::now(config('app.timezone','UTC'))->startOfMonth()->subMonth()->timestamp;
  $stats=DB::table('v2_stat_server')->where('server_type',$type)->where('server_id',$nodeId)->where('record_at','>=',$since)->get();
  foreach($stats as $s)self::record($budgetId,(int)$s->u,(int)$s->d,(int)$s->record_at);
  if($type==='v2box'){
   foreach(DB::table('v2_node_traffic_batch')->where('node_type',$type)->where('node_id',$nodeId)->whereNull('processed_at')->where('record_at','>=',$since)->cursor() as $batch){
    $u=0;$d=0;foreach(json_decode($batch->payload,true,512,JSON_THROW_ON_ERROR) as $bytes){$u+=$bytes[0];$d+=$bytes[1];}self::record($budgetId,$u,$d,(int)$batch->record_at);
   }
  }
 }
 public static function record(?int $budgetId,int $upload,int $download,int $dayAt): void {
  if(!$budgetId || ($upload===0 && $download===0))return;
  DB::statement('INSERT INTO v2_server_traffic_day (budget_id,day_at,upload_bytes,download_bytes) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE upload_bytes=upload_bytes+VALUES(upload_bytes),download_bytes=download_bytes+VALUES(download_bytes)',[$budgetId,$dayAt,$upload,$download]);
 }
 public static function resource($budget,bool $full=true): array {
  [$start,$end]=self::period($budget->reset_day);
  $sum=function(int $from,int $to)use($budget){$r=DB::table('v2_server_traffic_day')->where('budget_id',$budget->id)->where('day_at','>=',$from)->where('day_at','<',$to)->selectRaw('COALESCE(SUM(upload_bytes),0) AS u, COALESCE(SUM(download_bytes),0) AS d')->first();return ['uploadBytes'=>(int)$r->u,'downloadBytes'=>(int)$r->d];};
  $traffic=$sum($start->timestamp,$end->timestamp);
  $used=($budget->counting_mode==='download' ? 0 : $traffic['uploadBytes'])+($budget->counting_mode==='upload' ? 0 : $traffic['downloadBytes']);
  $month=CarbonImmutable::now(config('app.timezone','UTC'))->startOfMonth();
  $result=['id'=>(int)$budget->id,'name'=>$budget->name,'limitBytes'=>(int)$budget->limit_bytes,'countingMode'=>$budget->counting_mode,'resetDay'=>(int)$budget->reset_day,'usedBytes'=>$used,'blocked'=>$budget->limit_bytes>0 && $used >= $budget->limit_bytes,'periodStart'=>$start->utc()->toIso8601String(),'periodEnd'=>$end->utc()->toIso8601String(),'periodEndUnix'=>$end->timestamp,'traffic'=>$traffic];
  if($full){$result+=['thisMonth'=>$sum($month->timestamp,$month->addMonth()->timestamp),'last30Days'=>$sum(CarbonImmutable::now(config('app.timezone','UTC'))->startOfDay()->subDays(29)->timestamp,$month->addMonth()->timestamp)];}
  return $result;
 }
 public static function forNode(string $type,int $nodeId): ?array {
  $id=self::budgetId($type,$nodeId);$budget=$id ? DB::table('v2_server_traffic_budget')->find($id) : null;
  return $budget ? self::resource($budget,false) : null;
 }
 public static function decorateNodes(array $nodes): array {
  $bindings=DB::table('v2_server_traffic_binding')->get()->keyBy(fn($b)=>$b->node_type.':'.$b->node_id);
  $budgets=DB::table('v2_server_traffic_budget')->get()->keyBy('id');$resources=[];
  foreach($nodes as &$node){$root=($node['service_id'] ?? null) ?: $node['id'];$binding=$bindings->get($node['type'].':'.$root);$id=$binding ? $binding->budget_id : null;
   if($id && !isset($resources[$id]) && $budgets->has($id))$resources[$id]=self::resource($budgets->get($id),false);
   $node['traffic_budget']=$resources[$id] ?? null;
  }
  return $nodes;
 }
 public static function blocked(string $type,int $nodeId): bool {return self::forNode($type,$nodeId)['blocked'] ?? false;}
}
