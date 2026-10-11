<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\NodeDdnsService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\Rule;
class NodeDdnsController extends Controller {
    public function fetch() {
        return ['data'=>[
            'credentials'=>DB::table('v2_ddns_credential')->select('id','name','zone_id','status','next_run')->orderBy('id')->get(),
            'assignments'=>DB::table('v2_node_ddns')->select('id','credential_id','node_type','node_id','domain','family','enabled','ipv4','ipv6','ipv4_seen_at','ipv6_seen_at','last_success','status','next_run')->orderBy('id')->get(),
        ]];
    }
    public function saveCredential(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','name'=>'required|string|max:100','zone_id'=>['required','regex:/^[a-f0-9]{32}$/i'],'token'=>'nullable|string|max:512|regex:/^[A-Za-z0-9_.-]+$/']);
        return DB::transaction(function () use ($v) {
            $old=isset($v['id']) ? DB::table('v2_ddns_credential')->where('id',$v['id'])->lockForUpdate()->first() : null;
            abort_if(isset($v['id']) && !$old,404);
            abort_if(empty($v['token']) && (!$old || $old->zone_id!==$v['zone_id']),422,'新增凭据或更换 Zone 时必须填写 Token');
            $data=['name'=>$v['name'],'zone_id'=>strtolower($v['zone_id'])];
            if (!empty($v['token'])) $data+=['secret'=>Crypt::encryptString($v['token']),'status'=>'ready','next_run'=>0];
            $id=$old ? $old->id : DB::table('v2_ddns_credential')->insertGetId($data);
            if ($old) {
                DB::table('v2_ddns_credential')->where('id',$id)->update($data);
                if (!empty($v['token'])) DB::table('v2_node_ddns')->where('credential_id',$id)->update(['next_run'=>0,'status'=>'awaiting_report']);
            }
            return ['data'=>['id'=>$id]];
        });
    }
    public function dropCredential(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return DB::transaction(function () use ($v) {
            DB::table('v2_ddns_credential')->where('id',$v['id'])->lockForUpdate()->first();
            abort_if(DB::table('v2_node_ddns')->where('credential_id',$v['id'])->exists(),409,'请先移除使用此凭据的 DDNS 配置');
            DB::table('v2_ddns_credential')->where('id',$v['id'])->delete();
            return ['data'=>true];
        });
    }
    public function saveAssignment(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','credential_id'=>'required|integer|min:1','node_type'=>['required',Rule::in(['v2node','v2box'])],'node_id'=>'required|integer|min:1','domain'=>['required','string','max:253','regex:/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/'],'family'=>['required',Rule::in(['ipv4','ipv6','dual'])],'enabled'=>'required|boolean']);
        $v['domain']=strtolower($v['domain']);
        return DB::transaction(function () use ($v) {
            abort_unless(DB::table('v2_ddns_credential')->where('id',$v['credential_id'])->lockForUpdate()->first(),422,'请选择有效凭据');
            abort_unless(NodeDdnsService::nodeExists((object)$v),422,'节点不存在');
            $old=isset($v['id']) ? DB::table('v2_node_ddns')->where('id',$v['id'])->lockForUpdate()->first() : null;
            abort_if(isset($v['id']) && !$old,404);
            abort_if($old && ($old->node_type!==$v['node_type'] || $old->node_id!=$v['node_id']),422,'不能更换已绑定的节点，请新建配置');
            $other=DB::table('v2_node_ddns')->where('id','!=',$old->id ?? 0);
            abort_if((clone $other)->where('domain',$v['domain'])->exists() || (clone $other)->where('node_type',$v['node_type'])->where('node_id',$v['node_id'])->exists(),409,'该域名或节点已有 DDNS 配置');
            unset($v['id']); $v+=['next_run'=>0,'status'=>'awaiting_report'];
            // Changing family invalidates the bootstrap configuration; require redeployment.
            if ($old && $old->family!==$v['family']) $v+=['report_hash'=>null,'ipv4'=>null,'ipv6'=>null,'ipv4_seen_at'=>0,'ipv6_seen_at'=>0];
            $id=$old ? $old->id : DB::table('v2_node_ddns')->insertGetId($v);
            if ($old) DB::table('v2_node_ddns')->where('id',$id)->update($v);
            NodeDdnsService::event($id,'configuration_saved');
            return ['data'=>['id'=>$id]];
        });
    }
    public function dropAssignment(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        DB::table('v2_node_ddns')->where('id',$v['id'])->delete();
        NodeDdnsService::event($v['id'],'configuration_removed');
        return ['data'=>true];
    }
    public function rotate(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return DB::transaction(function () use ($v) {
            $row=DB::table('v2_node_ddns')->where('id',$v['id'])->lockForUpdate()->first(); abort_unless($row,404);
            $token=bin2hex(random_bytes(32));
            DB::table('v2_node_ddns')->where('id',$row->id)->update(['report_hash'=>hash('sha256',$token),'ipv4'=>null,'ipv6'=>null,'ipv4_seen_at'=>0,'ipv6_seen_at'=>0,'next_run'=>0,'status'=>'awaiting_report']);
            NodeDdnsService::event($row->id,'report_key_rotated');
            return response()->json(['data'=>['reportToken'=>$token,'family'=>$row->family]],200,['Cache-Control'=>'private, no-store']);
        });
    }
    public function events(Request $request) {
        $v=$request->validate(['page'=>'nullable|integer|min:1','pageSize'=>'nullable|integer|min:1|max:100','assignmentId'=>'nullable|integer|min:1']);
        $q=DB::table('v2_ddns_event'); if (!empty($v['assignmentId'])) $q->where('assignment_id',$v['assignmentId']);
        $total=(clone $q)->count(); $size=$v['pageSize'] ?? 20; $page=$v['page'] ?? 1;
        return ['data'=>$q->orderByDesc('id')->forPage($page,$size)->get(),'total'=>$total];
    }
}
