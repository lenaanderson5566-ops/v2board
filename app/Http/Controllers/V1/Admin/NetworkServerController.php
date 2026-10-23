<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\NetworkServer;
use App\Services\NodeDnsLifecycle;
use App\Services\NodeDeployment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class NetworkServerController extends Controller {
    public function save(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','name'=>'required|string|max:100','family'=>'required|in:ipv4,ipv6,dual','enabled'=>'required|boolean']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $old=isset($v['id'])?DB::table('v2_network_server')->find($v['id']):null;
            abort_if(isset($v['id']) && !$old,404);
            abort_if(!$old && DB::table('v2_network_server')->count()>=1000,422,'最多维护 1000 台服务器');
            abort_if($old && $old->family!==$v['family'] && DB::table('v2_node_ddns')->where('server_id',$old->id)->exists(),409,'请先调整关联域名，再更改服务器地址类型');
            unset($v['id']);
            $id=$old?$old->id:DB::table('v2_network_server')->insertGetId($v);
            if ($old) DB::table('v2_network_server')->where('id',$id)->update($v);
            return ['data'=>['id'=>$id]];
        }));
    }
    public function drop(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return NodeDnsLifecycle::locked(function()use($v){
            abort_if(DB::table('v2_node_ddns')->where('server_id',$v['id'])->exists(),409,'请先解除此服务器关联的域名');
            DB::table('v2_network_server')->where('id',$v['id'])->delete();
            return ['data'=>true];
        });
    }
    public function enroll(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return response()->json(['data'=>NodeDeployment::createServer($v['id'],(int)$request->input('user.id'))],200,['Cache-Control'=>'private, no-store']);
    }
    public function reset(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','confirm'=>'required|accepted']);
        NodeDnsLifecycle::locked(function()use($v){
            abort_unless(DB::table('v2_network_server')->where('id',$v['id'])->where('enabled',true)->exists(),422,'请先启用服务器');
            DB::table('v2_network_server')->where('id',$v['id'])->update(['report_hash'=>null,'report_secret'=>null]);
            DB::table('v2_node_ddns')->where('server_id',$v['id'])->update(['report_hash'=>null]);
        });
        return $this->enroll($request);
    }
    public function entry(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','server_id'=>'required|integer|min:1','credential_id'=>'required|integer|min:1','prefix'=>'required|string|max:63','family'=>'required|in:ipv4,ipv6,dual']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $c=DB::table('v2_ddns_credential')->find($v['credential_id']);
            abort_unless($c && $c->root_domain,422,'请先维护 Cloudflare 根域名');
            $old=isset($v['id'])?DB::table('v2_node_ddns')->find($v['id']):null;
            abort_if(isset($v['id']) && (!$old || $old->purpose!=='entry'),404);
            abort_if($old && (DB::table('v2_node_ddns')->where('entry_id',$old->id)->exists() || \App\Services\NodeConnection::referencesEntry($old->id)),409,'正在使用的入口请新增域名后逐个验证切换，避免影响共享节点');
            $domain=NodeDnsLifecycle::name(strtolower($v['prefix']),$c->root_domain);
            abort_if(DB::table('v2_node_ddns')->where('domain',$domain)->where('id','!=',$old->id??0)->exists() || DB::table('v2_node_dns_record')->where('domain',$domain)->where('assignment_id','!=',$old->id??0)->exists(),409,'域名已被使用或仍在清理中');
            abort_if(DB::table('v2_node_ddns')->where('server_id',$v['server_id'])->where('id','!=',$old->id??0)->count()>=100,422,'一台服务器最多关联 100 个域名');
            if ($old && $old->domain!==$domain) NodeDnsLifecycle::retire($old->id);
            $data=['credential_id'=>$c->id,'domain'=>$domain,'family'=>$v['family'],'purpose'=>'entry','node_type'=>'entry','enabled'=>true,'managed'=>true,'next_run'=>0,'status'=>'awaiting_report','published_domain'=>$domain];
            $id=$old?$old->id:DB::table('v2_node_ddns')->insertGetId($data+['node_id'=>0]);
            DB::table('v2_node_ddns')->where('id',$id)->update($data+['node_id'=>$id]);
            NetworkServer::attach($id,$v['server_id']);
            return ['data'=>['id'=>$id]];
        }));
    }
    public function dropEntry(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        abort_unless(DB::table('v2_node_ddns')->where('id',$v['id'])->where('purpose','entry')->exists(),404);
        return app(NodeDdnsController::class)->dropAssignment($request);
    }
    public function confirmRelay(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','confirm'=>'required|accepted']);
        return NodeDnsLifecycle::locked(function()use($v){
            $a=DB::table('v2_node_ddns')->find($v['id']);
            abort_unless($a && $a->entry_id && NetworkServer::ready($a) && NetworkServer::ready(NetworkServer::target($a)) && $a->published_domain===NetworkServer::target($a)->domain && (int)$a->published_port===(int)$a->entry_port && $a->tls_transition_state!=='pending',409,'请先完成域名与节点证书验证');
            DB::table('v2_node_ddns')->where('id',$a->id)->update(['relay_verified_at'=>time(),'published_origin'=>$a->domain]);
            DB::table('v2_node_dns_record')->where('assignment_id',$a->id)->where('domain','!=',$a->domain)->where('delete_after',0)->update(['delete_after'=>time()+86400,'next_run'=>0,'status'=>'pending_cleanup']);
            return ['data'=>true];
        });
    }
}
