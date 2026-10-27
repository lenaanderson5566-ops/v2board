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
        $v=$request->validate(['id'=>'nullable|integer|min:1','name'=>'required|string|max:100','family'=>'required|in:ipv4,ipv6,dual','enabled'=>'required|boolean','traffic'=>'sometimes|array:limitBytes,countingMode,resetDay','traffic.limitBytes'=>'required_with:traffic|integer|min:0|max:9007199254740991','traffic.countingMode'=>'required_with:traffic|in:upload,download,both','traffic.resetDay'=>'required_with:traffic|integer|min:1|max:28','entry'=>'sometimes|array:credential_id,prefix,family|required_array_keys:credential_id,prefix,family','entry.credential_id'=>'required_with:entry|integer|min:1','entry.prefix'=>'required_with:entry|string|max:63','entry.family'=>'required_with:entry|in:ipv4,ipv6,dual']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $old=isset($v['id'])?DB::table('v2_network_server')->find($v['id']):null;
            abort_if(isset($v['id']) && !$old,404);
            abort_if(!$old && DB::table('v2_network_server')->count()>=1000,422,'最多维护 1000 台服务器');
            abort_if($old && $old->family!==$v['family'] && $v['family']!=='dual' && DB::table('v2_node_ddns')->where('server_id',$old->id)->where('family','!=',$v['family'])->exists(),409,'关联域名仍需要其他地址类型，请先调整关联域名，再缩减服务器地址类型');
            $traffic=$v['traffic']??null;$entry=$v['entry']??null;
            abort_if($entry && ($old || !$v['enabled']),422,'请在启用的新服务器配置入口；已有服务器请在详情管理入口域名');
            unset($v['id'],$v['traffic'],$v['entry']);
            $id=$old?$old->id:DB::table('v2_network_server')->insertGetId($v);
            if ($old) DB::table('v2_network_server')->where('id',$id)->update($v);
            if($traffic) \App\Services\NetworkServerTraffic::save((int)$id,$traffic);
            $entryId=$entry?$this->saveEntry($entry+['server_id'=>(int)$id])['data']['id']:null;
            return ['data'=>['id'=>$id,'entryId'=>$entryId]];
        }));
    }
    public function traffic(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        abort_unless(DB::table('v2_network_server')->where('id',$v['id'])->exists(),404);
        $b=\App\Services\NetworkServerTraffic::budget((int)$v['id']);
        $history=$b?DB::table('v2_server_traffic_day')->where('budget_id',$b->id)->where('day_at','>=',time()-90*86400)->orderByDesc('day_at')->limit(90)->get()->map(fn($r)=>['dayAt'=>(int)$r->day_at,'uploadBytes'=>(int)$r->upload_bytes,'downloadBytes'=>(int)$r->download_bytes]):[];
        return ['data'=>['budget'=>$b?\App\Services\ServerTrafficBudgetService::resource($b):null,'history'=>$history,'nodes'=>array_map(function($n){$node=(new \App\Services\ServerService())->getServer($n['id'],$n['type']);return $n+['name'=>$node?->name,'protocol'=>$node?->protocol,'listenPort'=>(int)($node?->server_port??0)];},\App\Services\NetworkServerTraffic::nodes((int)$v['id']))]];
    }
    public function drop(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $bindings=DB::table('v2_node_ddns')->where('server_id',$v['id'])->get();
            foreach($bindings as $binding) {
                abort_if($binding->purpose!=='entry' || DB::table('v2_node_ddns')->where('entry_id',$binding->id)->exists() || \App\Services\NodeConnection::referencesEntry($binding->id),409,'服务器域名仍被节点使用，请先解除关联线路；未使用的入口域名可随服务器一起删除');
            }
            foreach($bindings as $binding) {
                NodeDnsLifecycle::retire((int)$binding->id);
                DB::table('v2_node_ddns')->where('id',$binding->id)->delete();
                \App\Services\NodeDdnsService::event((int)$binding->id,'configuration_removed');
            }
            DB::table('v2_server_traffic_budget')->where('network_server_id',$v['id'])->update(['network_server_id'=>null]);
            DB::table('v2_network_server')->where('id',$v['id'])->delete();
            return ['data'=>true];
        }));
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
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(fn()=>$this->saveEntry($v)));
    }
    /** Caller owns the lifecycle lock and transaction; never acquire it recursively. */
    private function saveEntry(array $v): array {
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
    }
    public function dropEntry(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        abort_unless(DB::table('v2_node_ddns')->where('id',$v['id'])->where('purpose','entry')->exists(),404);
        return app(NodeDdnsController::class)->dropAssignment($request);
    }
    public function originCleanupPreview(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return response()->json(['data'=>NodeDnsLifecycle::previewOriginCleanup($v['id'])],200,['Cache-Control'=>'private, no-store']);
    }
    public function cleanupOrigin(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','proof'=>'required|string|size:64','confirm'=>'required|accepted']);
        return ['data'=>NodeDnsLifecycle::scheduleOriginCleanup($v['id'],$v['proof'])];
    }
}
