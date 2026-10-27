<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\ServerTrafficBudgetService as Budgets;
use App\Services\ServerService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class ServerTrafficBudgetController extends Controller {
 public function fetch(Request $request){
  $existing=['v2box'=>\App\Models\ServerV2box::pluck('service_id','id')];
  $bindings=DB::table('v2_server_traffic_binding')->get()->filter(fn($n)=>$existing[$n->node_type]->has($n->node_id) && !$existing[$n->node_type]->get($n->node_id))->groupBy('budget_id');
  $data=collect(Budgets::resources(DB::table('v2_server_traffic_budget')->orderBy('id')->get()))->map(fn($b)=>$b+['nodes'=>($bindings->get($b['id']) ?? collect())->map(fn($n)=>['type'=>$n->node_type,'id'=>(int)$n->node_id])->values()->all()]);
  return response()->json(['data'=>$data]);
 }
 public function save(Request $request){
  $v=$request->validate(['id'=>'nullable|integer|min:1','name'=>'required|string|max:100','limitBytes'=>'required|integer|min:0|max:9007199254740991','countingMode'=>'required|in:upload,download,both','resetDay'=>'required|integer|min:1|max:28','nodes'=>'present|array|max:1000','nodes.*.type'=>'required|in:v2box','nodes.*.id'=>'required|integer|min:1']);
  return DB::transaction(function()use($v){
   // Serialize binding changes; one physical node cannot belong to two server budgets.
   DB::table('v2_server_traffic_budget')->orderBy('id')->lockForUpdate()->get();
   $id=$v['id'] ?? null;if($id)abort_unless(DB::table('v2_server_traffic_budget')->find($id),404);
   $linked=$id?DB::table('v2_server_traffic_budget')->find($id):null;
   if($linked && $linked->network_server_id){
    $identity=fn($nodes)=>collect($nodes)->map(fn($n)=>$n['type'].':'.$n['id'])->sort()->values()->all();
    abort_unless($identity($v['nodes'])===$identity(\App\Services\NetworkServerTraffic::nodes((int)$linked->network_server_id)),409,'服务器额度的服务绑定由服务器配置自动维护');
   }
   $keys=[];
   usort($v['nodes'],fn($a,$b)=>[$a['type'],$a['id']] <=> [$b['type'],$b['id']]);
   foreach($v['nodes'] as $n){$key=$n['type'].':'.$n['id'];abort_if(isset($keys[$key]),422,'Duplicate node');$keys[$key]=true;$node=(new ServerService())->getServer($n['id'],$n['type']);abort_unless($node && !$node->service_id,422,'请选择独立代理服务');DB::table('v2_server_'.$n['type'])->where('id',$n['id'])->lockForUpdate()->first();$binding=DB::table('v2_server_traffic_binding')->where('node_type',$n['type'])->where('node_id',$n['id'])->first();abort_if($binding && $binding->budget_id!=$id,409,'Node already belongs to another server');}
   $fields=['name'=>$v['name'],'limit_bytes'=>$v['limitBytes'],'counting_mode'=>$v['countingMode'],'reset_day'=>$v['resetDay']];
   if($id)DB::table('v2_server_traffic_budget')->where('id',$id)->update($fields);else $id=DB::table('v2_server_traffic_budget')->insertGetId($fields);
   DB::table('v2_server_traffic_binding')->where('budget_id',$id)->delete();
   foreach($v['nodes'] as $n)DB::table('v2_server_traffic_binding')->insert(['budget_id'=>$id,'node_type'=>$n['type'],'node_id'=>$n['id']]);
   foreach($v['nodes'] as $n)Budgets::importHistory($id,$n['type'],$n['id']);
   return response()->json(['data'=>['id'=>$id]]);
  },3);
 }
}
