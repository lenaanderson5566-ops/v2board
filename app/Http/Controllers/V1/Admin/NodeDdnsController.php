<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Services\NodeDdnsService;
use App\Services\NodeDnsLifecycle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
class NodeDdnsController extends Controller {
    public function fetch() {
        $connections=DB::table('v2_node_connection')->select('id','node_type','node_id','entry_id','entry_port','published','revision','verified_at')->get()->map(function($c){$c->published=$c->published?json_decode($c->published,true):null;return $c;});
        $assignments=DB::table('v2_node_ddns')->select('id','server_id','entry_id','entry_port','purpose','published_origin','published_port','relay_verified_at','credential_id','node_type','node_id','domain','published_domain','tls_transition_state','tls_transition','managed','family','enabled','ipv4','ipv6','ipv4_seen_at','ipv6_seen_at','last_success','status','next_run')->orderBy('id')->get();
        $keys=$assignments->where('node_type','v2box')->map(fn($a)=>'V2BOX_CAPABILITIES:'.$a->node_id)->unique()->values()->all();
        $capabilities=$keys ? Cache::many($keys) : [];
        $dnsKeys=$assignments->where('node_type','v2box')->map(fn($a)=>'NODE_DEPLOY_DNS:'.$a->node_id)->unique()->values()->all();
        $dnsObservations=$dnsKeys?Cache::many($dnsKeys):[];
        $autoKeys=$assignments->map(fn($a)=>'domain-auto-state:'.$a->id)->all();
        $automatic=$autoKeys?Cache::many($autoKeys):[];
        $servers=DB::table('v2_network_server')->select('id','name','family','enabled','ipv4','ipv6','ipv4_seen_at','ipv6_seen_at')->orderBy('id')->get();
        $serverMap=$servers->keyBy('id'); $byId=$assignments->keyBy('id');
        $entryIds=$assignments->pluck('entry_id')->filter()->unique()->all();
        $records=$entryIds ? DB::table('v2_node_dns_record')->whereIn('assignment_id',$entryIds)->where('status','active')->where('delete_after',0)->whereNotNull('record_id')->get()->groupBy('assignment_id') : collect();
        $ready=[];
        $connectionCounts=[];
        foreach($connections as $connection) foreach(array_unique(array_filter([$connection->entry_id,$connection->published['entry_id']??null])) as $entryId) $connectionCounts[$entryId]=($connectionCounts[$entryId]??0)+1;
        foreach($assignments as $assignment) if($assignment->entry_id) $connectionCounts[$assignment->entry_id]=($connectionCounts[$assignment->entry_id]??0)+1;
        foreach ($entryIds as $id) {
            $e=$byId->get($id);$ok=$e && $e->enabled && ($serverMap->get($e->server_id)->enabled??false) && in_array($e->status,['healthy','ready_to_switch'],true) && $e->last_success>=time()-900;
            if ($e) foreach($e->family==='dual'?['ipv4','ipv6']:[$e->family] as $f) $ok=$ok && $e->$f && $e->{$f.'_seen_at'}>=time()-900 && $records->get($id,collect())->contains(fn($r)=>$r->credential_id==$e->credential_id && $r->domain===$e->domain && $r->type===($f==='ipv4'?'A':'AAAA') && $r->content===$e->$f);
            $ready[$id]=(bool)$ok;
        }
        return ['data'=>[
            'connections'=>$connections,
            'servers'=>$servers,
            'credentials'=>DB::table('v2_ddns_credential')->select('id','name','zone_id','root_domain','status','next_run')->orderBy('id')->get(),
            'assignments'=>$assignments->map(function($a)use($automatic,$dnsObservations,$capabilities,$byId,$ready,$serverMap,$connectionCounts){
                $a->deployment_dns=$a->node_type==='v2box'?($dnsObservations['NODE_DEPLOY_DNS:'.$a->node_id]??null):null;
                if ($a->deployment_dns) { unset($a->deployment_dns['proof']); }
                $a->configuration_revision=NodeDomainController::revision($a);
                $state=$automatic['domain-auto-state:'.$a->id]??null;
                $a->automatic_status=$state && ($state['revision']??null)===$a->configuration_revision ? $state['code'] : null;
                $a->connection_count=$connectionCounts[$a->id]??0;
                $entry=$a->entry_id ? $byId->get($a->entry_id) : null;
                $a->connection_domain=$entry ? $entry->domain : $a->domain;
                $a->entry_ready=$a->entry_id ? ($ready[$a->entry_id]??false) : true;
                $a->server_enabled=$serverMap->get($a->server_id)->enabled??false;
                $a->certificate_transition_supported=$a->node_type==='v2box' && in_array('certificate-transition-v1',$capabilities['V2BOX_CAPABILITIES:'.$a->node_id]['features']??[],true);
                if ($a->tls_transition_state==='pending') {
                    try { $p=json_decode(Crypt::decryptString($a->tls_transition),true,512,JSON_THROW_ON_ERROR); if (($p['expires']??0)<=time()) $a->tls_transition_state='failed'; }
                    catch (\Throwable $e) { $a->tls_transition_state='failed'; }
                }
                unset($a->tls_transition); return $a;
            }),
        ]];
    }
    public function saveCredential(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','name'=>'required|string|max:100','zone_id'=>['required','regex:/^[a-f0-9]{32}$/i'],'token'=>'nullable|string|max:512|regex:/^[A-Za-z0-9_.-]+$/','root_domain'=>'nullable|string|max:253']);
        return NodeDnsLifecycle::locked(function () use ($v) {
            $old=isset($v['id']) ? DB::table('v2_ddns_credential')->find($v['id']) : null;
            abort_if(isset($v['id']) && !$old,404);
            $zone=strtolower($v['zone_id']);
            abort_if($old && $old->zone_id!==$zone && \App\Services\NodeCertificateCredential::referenced($old->id),409,'凭据仍用于节点证书，请先修改节点证书配置');
            abort_if($old && $old->zone_id!==$zone && (DB::table('v2_node_ddns')->where('credential_id',$old->id)->exists() || DB::table('v2_node_dns_record')->where('credential_id',$old->id)->exists()),409,'凭据仍关联节点或历史解析，请新增根域名后使用批量迁移');
            abort_if(empty($v['token']) && (!$old || $old->zone_id!==$zone),422,'新增凭据或更换 Zone 时必须填写 Token');
            $data=['name'=>$v['name'],'zone_id'=>$zone];
            if (!empty($v['token'])) $data+=['secret'=>Crypt::encryptString($v['token']),'status'=>'ready','next_run'=>0];
            $root=strtolower(trim($v['root_domain']??$old->root_domain??''));
            if ($root) {
                abort_unless(preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',$root),422,'根域名格式无效');
                abort_if($old && $old->root_domain && $old->root_domain!==$root,409,'更换根域名请新增凭据并执行迁移');
                try { $zoneInfo=app(NodeDdnsService::class)->api((object)($data+['secret'=>$old->secret??'']),'GET','',[],true); }
                catch (\App\Services\NodeDdnsFailure $e) { abort(422,'根域名验证失败：'.$e->getMessage()); }
                abort_unless(($zoneInfo['result']['name']??'')===$root && ($zoneInfo['result']['status']??'')==='active',422,'Zone 与根域名不一致或域名尚未激活');
                $data['root_domain']=$root;
            }
            $id=$old?$old->id:DB::table('v2_ddns_credential')->insertGetId($data);
            if ($old) DB::table('v2_ddns_credential')->where('id',$id)->update($data);
            if (!empty($v['token'])) {
                foreach (['v2box','v2node'] as $type) {
                    DB::table('v2_server_'.$type)->where('tls_settings->dns_credential_id',$id)->select('id')->orderBy('id')->chunkById(100,function($nodes)use($type){
                        foreach ($nodes as $node) \App\Services\NodeRuntimeService::invalidate($type,(int)$node->id);
                    });
                }
                DB::table('v2_node_ddns')->where('credential_id',$id)->update(['next_run'=>0,'status'=>'awaiting_report']);
                DB::table('v2_node_dns_record')->where('credential_id',$id)->where('delete_after','>',0)->update(['next_run'=>0]);
            }
            return ['data'=>['id'=>$id]];
        });
    }
    public function dropCredential(Request $request) {
        return NodeDnsLifecycle::locked(fn()=>$this->dropCredentialUnlocked($request));
    }
    private function dropCredentialUnlocked(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return DB::transaction(function () use ($v) {
            DB::table('v2_ddns_credential')->where('id',$v['id'])->lockForUpdate()->first();
            abort_if(DB::table('v2_node_dns_record')->where('credential_id',$v['id'])->exists() || DB::table('v2_node_ddns')->where('credential_id',$v['id'])->exists(),409,'请先移除使用此凭据的 DDNS 配置');
            abort_if(\App\Services\NodeCertificateCredential::referenced($v['id']),409,'凭据仍用于节点证书，请先修改节点证书配置');
            DB::table('v2_ddns_credential')->where('id',$v['id'])->delete();
            return ['data'=>true];
        });
    }
    public function saveAssignment(Request $request) {
        return NodeDnsLifecycle::locked(fn()=>$this->saveAssignmentUnlocked($request));
    }
    private function saveAssignmentUnlocked(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1','credential_id'=>'required|integer|min:1','node_type'=>['required',Rule::in(['v2node','v2box'])],'node_id'=>'required|integer|min:1','domain'=>['required','string','max:253','regex:/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/'],'family'=>['required',Rule::in(['ipv4','ipv6','dual'])],'enabled'=>'required|boolean']);
        $v['domain']=strtolower($v['domain']);
        return DB::transaction(function () use ($v) {
            abort_unless(DB::table('v2_ddns_credential')->where('id',$v['credential_id'])->lockForUpdate()->first(),422,'请选择有效凭据');
            abort_unless(NodeDdnsService::nodeExists((object)$v),422,'节点不存在');
            $old=isset($v['id']) ? DB::table('v2_node_ddns')->where('id',$v['id'])->lockForUpdate()->first() : null;
            abort_if(isset($v['id']) && !$old,404);
            abort_if($old && $old->managed,409,'托管域名请通过域名与解析编辑');
            abort_if($old && ($old->node_type!==$v['node_type'] || $old->node_id!=$v['node_id']),422,'不能更换已绑定的节点，请新建配置');
            $other=DB::table('v2_node_ddns')->where('id','!=',$old->id ?? 0);
            abort_if((clone $other)->where('domain',$v['domain'])->exists() || (clone $other)->where('node_type',$v['node_type'])->where('node_id',$v['node_id'])->exists(),409,'该域名或节点已有 DDNS 配置');
            unset($v['id']); $v+=['next_run'=>0,'status'=>'awaiting_report'];
            // Changing family invalidates the bootstrap configuration; require redeployment.
            if ($old && $old->family!==$v['family']) $v+=['report_hash'=>null,'ipv4'=>null,'ipv6'=>null,'ipv4_seen_at'=>0,'ipv6_seen_at'=>0];
            $id=$old ? $old->id : DB::table('v2_node_ddns')->insertGetId($v);
            if ($old) DB::table('v2_node_ddns')->where('id',$id)->update($v);
            \App\Services\NetworkServer::attach($id);
            NodeDdnsService::event($id,'configuration_saved');
            return ['data'=>['id'=>$id]];
        });
    }
    public function dropAssignment(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $assignment=DB::table('v2_node_ddns')->find($v['id']);
            if ($assignment && in_array($assignment->node_type,['v2node','v2box'],true)) \App\Services\ProxyService::assertUnused($assignment->node_type,(int)$assignment->node_id);
            abort_if((DB::table('v2_node_ddns')->where('entry_id',$v['id'])->exists() || \App\Services\NodeConnection::referencesEntry($v['id'])),409,'入口仍被节点引用，请先解除关联');
            NodeDnsLifecycle::retire($v['id']);
            DB::table('v2_node_ddns')->where('id',$v['id'])->delete();
            NodeDdnsService::event($v['id'],'configuration_removed');
        }));
        return ['data'=>true];
    }
    public function rotate(Request $request) {
        return NodeDnsLifecycle::locked(fn()=>$this->rotateUnlocked($request));
    }
    private function rotateUnlocked(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return DB::transaction(function () use ($v) {
            $row=DB::table('v2_node_ddns')->where('id',$v['id'])->lockForUpdate()->first(); abort_unless($row,404);
            $id=\App\Services\NetworkServer::attach($row->id);
            abort_if(DB::table('v2_node_ddns')->where('server_id',$id)->count()>1,409,'此服务器被多个域名共享，请在服务器管理中重新配置上报');
            $network=\App\Services\NetworkServer::credential($id,true);
            return response()->json(['data'=>['reportToken'=>$network['token'],'family'=>$network['family']]],200,['Cache-Control'=>'private, no-store']);
        });
    }
    public function events(Request $request) {
        $v=$request->validate(['page'=>'nullable|integer|min:1','pageSize'=>'nullable|integer|min:1|max:100','assignmentId'=>'nullable|integer|min:1']);
        $q=DB::table('v2_ddns_event'); if (!empty($v['assignmentId'])) $q->where('assignment_id',$v['assignmentId']);
        $total=(clone $q)->count(); $size=$v['pageSize'] ?? 20; $page=$v['page'] ?? 1;
        return ['data'=>$q->orderByDesc('id')->forPage($page,$size)->get(),'total'=>$total];
    }
}
