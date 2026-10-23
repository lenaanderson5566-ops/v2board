<?php
namespace App\Services;

use App\Http\Controllers\V1\Admin\ServerTrafficBudgetController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Configuration path only. Traffic receipt and counting continue through the existing bindings. */
final class NetworkServerTraffic {
 public static function nodes(int $server): array {
  $result=[];
  foreach(DB::table('v2_node_ddns')->where('server_id',$server)->whereIn('node_type',['v2box','v2node'])->get(['node_type','node_id']) as $a){
   $node=DB::table('v2_server_'.$a->node_type)->find($a->node_id);
   if($node && !$node->service_id)$result[$a->node_type.':'.$a->node_id]=['type'=>$a->node_type,'id'=>(int)$a->node_id];
  }
  ksort($result);return array_values($result);
 }
 public static function budget(int $server) {
  $linked=DB::table('v2_server_traffic_budget')->where('network_server_id',$server)->first();if($linked)return $linked;
  $nodes=self::nodes($server);$ids=[];
  foreach($nodes as $n){$id=DB::table('v2_server_traffic_binding')->where('node_type',$n['type'])->where('node_id',$n['id'])->value('budget_id');if($id)$ids[(int)$id]=true;}
  if(count($ids)!==1)return null;
  $budget=DB::table('v2_server_traffic_budget')->find(array_key_first($ids));if(!$budget || $budget->network_server_id)return null;
  foreach(DB::table('v2_server_traffic_binding')->where('budget_id',$budget->id)->get() as $b)if(!in_array(['type'=>$b->node_type,'id'=>(int)$b->node_id],$nodes,true))return null;
  return $budget;
 }
 public static function save(int $server,array $settings): int {
  $physical=DB::table('v2_network_server')->where('id',$server)->lockForUpdate()->first();abort_unless($physical,404);
  DB::table('v2_server_traffic_budget')->orderBy('id')->lockForUpdate()->get();
  $nodes=self::nodes($server);
  $budget=DB::table('v2_server_traffic_budget')->where('network_server_id',$server)->first();
  $ids=[];
  foreach($nodes as $n){$id=DB::table('v2_server_traffic_binding')->where('node_type',$n['type'])->where('node_id',$n['id'])->value('budget_id');if($id)$ids[(int)$id]=true;}
  abort_if(count($ids)>1 || ($budget && $ids && !isset($ids[$budget->id])),409,'此服务器存在多个历史额度或其他服务器的额度，请在详情中整理历史绑定后保存');
  if(!$budget && $ids){
   $budget=DB::table('v2_server_traffic_budget')->find(array_key_first($ids));
   abort_if($budget->network_server_id && $budget->network_server_id!=$server,409,'代理服务仍绑定其他服务器的额度');
   foreach(DB::table('v2_server_traffic_binding')->where('budget_id',$budget->id)->get() as $b){
    abort_unless(in_array(['type'=>$b->node_type,'id'=>(int)$b->node_id],$nodes,true),409,'历史额度包含其他服务器或未关联服务器的服务，请先整理绑定');
   }
   DB::table('v2_server_traffic_budget')->where('id',$budget->id)->update(['network_server_id'=>$server]);
  }
  if($budget)foreach(DB::table('v2_server_traffic_binding')->where('budget_id',$budget->id)->get() as $binding){
   $node=DB::table('v2_server_'.$binding->node_type)->find($binding->node_id);
   abort_if($node && !$node->service_id && !in_array(['type'=>$binding->node_type,'id'=>(int)$binding->node_id],$nodes,true),409,'已有额度包含归属不明确的代理服务，请先恢复其服务器关联');
  }
  $payload=['name'=>$physical->name,'nodes'=>$nodes]+$settings;
  if($budget)$payload['id']=$budget->id;
  $response=(new ServerTrafficBudgetController())->save(Request::create('/','POST',$payload));
  $id=json_decode($response->getContent(),true)['data']['id'];
  DB::table('v2_server_traffic_budget')->where('id',$id)->update(['network_server_id'=>$server]);return $id;
 }
 public static function sync(int $server): void {
  $b=DB::table('v2_server_traffic_budget')->where('network_server_id',$server)->first();
  if($b)self::save($server,['limitBytes'=>(int)$b->limit_bytes,'countingMode'=>$b->counting_mode,'resetDay'=>(int)$b->reset_day]);
 }
}
