<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\NodeDdnsService;
use App\Services\NodeDnsLifecycle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class NodeDomainController extends Controller
{
    public static function revision($a): string {
        $values=[];$data=(array)$a;
        foreach(['credential_id','domain','family','server_id','entry_id','entry_port','enabled','managed'] as $key)$values[$key]=$data[$key]??null;
        return hash('sha256',json_encode($values));
    }
    public function bind(Request $request) {
        return NodeDnsLifecycle::locked(fn()=>$this->bindWithinLock($request));
    }
    /** Caller holds the DNS lifecycle lock; also used by atomic node creation. */
    public function bindWithinLock(Request $request) {
        $v=$request->validate(['credential_id'=>'required|integer|min:1','node_type'=>'required|in:v2node,v2box','node_id'=>'required|integer|min:1','prefix'=>'nullable|string|max:63','family'=>'required|in:ipv4,ipv6,dual','server_id'=>'nullable|integer|min:1','entry_id'=>'nullable|integer|min:1','entry_port'=>'nullable|integer|min:1|max:65535','revision'=>'nullable|string|size:64']);
        return DB::transaction(function()use($v){
            $c=DB::table('v2_ddns_credential')->find($v['credential_id']);
            abort_unless($c && $c->root_domain,422,'请先验证根域名');
            $n=DB::table('v2_server_'.$v['node_type'])->where('id',$v['node_id'])->lockForUpdate()->first();
            abort_unless($n && !$n->service_id,422,'请选择有效的代理服务');
            $old=DB::table('v2_node_ddns')->where('node_type',$v['node_type'])->where('node_id',$v['node_id'])->first();
            if(isset($v['revision'])) abort_unless($old && hash_equals(self::revision($old),$v['revision']),409,'域名配置已被其他管理员修改，请重新载入后保存');
            if ($old && !empty($v['server_id']) && (int)$v['server_id']!==(int)$old->server_id) \App\Services\ProxyService::assertUnused($v['node_type'],(int)$v['node_id']);
            $prefix=strtolower($v['prefix']??'');
            if (!$prefix) $prefix='n-'.bin2hex(random_bytes(5));
            $domain=NodeDnsLifecycle::name($prefix,$c->root_domain);
            $entry=null;
            if (!empty($v['entry_id'])) {
                abort_unless($v['node_type']==='v2box' && !empty($v['entry_port']),422,'中转需要 V2Box 节点和入口端口');
                $entry=DB::table('v2_node_ddns')->find($v['entry_id']);
                abort_unless($entry && $entry->purpose==='entry' && $entry->enabled,422,'请选择有效入口域名');
                $entryIds=DB::table('v2_node_ddns')->where('purpose','entry')->where('server_id',$entry->server_id)->pluck('id');
                abort_if(DB::table('v2_node_connection')->where(function($q)use($entryIds,$v){
                    $q->where(fn($q)=>$q->whereIn('entry_id',$entryIds)->where('entry_port',$v['entry_port']))
                        ->orWhere(fn($q)=>$q->whereIn('published->entry_id',$entryIds)->where('published->port',$v['entry_port']));
                })->exists(),409,'入口服务器端口已被关联线路占用');
                abort_if(DB::table('v2_node_ddns')->whereIn('entry_id',DB::table('v2_node_ddns')->where('purpose','entry')->where('server_id',$entry->server_id)->select('id'))->where('entry_port',$v['entry_port'])->where('id','!=',$old->id??0)->exists(),409,'此入口端口已被另一节点使用');
                abort_if(!empty($v['server_id']) && $entry->server_id==($v['server_id']??$old->server_id??0),422,'入口和回源应选择不同服务器');
            }
            $same=$old && $old->enabled && $old->managed && $old->status!=='host_changed' && ($n->host===$old->published_domain || $n->host===($entry->domain??$domain)) && $old->domain===$domain && (int)$old->credential_id===(int)$c->id
                && $old->family===$v['family'] && (int)$old->entry_id===(int)($entry->id??0)
                && (int)$old->entry_port===(int)($entry ? $v['entry_port'] : 0)
                && (empty($v['server_id']) || (int)$old->server_id===(int)$v['server_id']);
            if($same && DB::table('v2_network_server')->where('id',$old->server_id)->where('enabled',true)->exists())
                return ['data'=>['id'=>$old->id,'domain'=>$domain,'unchanged'=>true]];
            $tls=json_decode($n->tls_settings??'{}',true)?:[];
            if ((int)$n->tls===1 && !empty($tls['dns_credential_id'])) \App\Services\NodeCertificateCredential::credential(array_replace($tls,['server_name'=>$entry ? $entry->domain : $domain]));
            if ($entry && (int)$n->tls===1) \App\Services\NetworkServer::tls((object)['entry_id'=>$entry->id],$tls);
            if ((int)$n->tls===1 && in_array($tls['cert_mode']??'',['http','dns'],true) && empty($tls['server_name'])) {
                $tls['server_name']=$entry ? $entry->domain : $domain;
                DB::table('v2_server_'.$v['node_type'])->where('id',$n->id)->update(['tls_settings'=>json_encode($tls),'updated_at'=>time()]);
            }
            abort_if(DB::table('v2_node_ddns')->where('domain',$domain)->where('id','!=',$old->id??0)->exists(),409,'域名已绑定其他节点');
            abort_if(DB::table('v2_node_dns_record')->where('domain',$domain)->where('delete_after','>',0)->exists(),409,'此域名仍在历史解析清理中');
            if ($old && ($old->domain!==$domain || $old->credential_id!=$c->id)) {
                // Retire abandoned preparations, but retain the currently published records until activation.
                DB::table('v2_node_dns_record')->where('assignment_id',$old->id)->where('domain','!=',$old->published_domain)->when($old->published_origin,fn($q)=>$q->where('domain','!=',$old->published_origin))->where('delete_after',0)->update(['delete_after'=>time()+1,'next_run'=>0,'status'=>'pending_cleanup']);
            }
            $data=['entry_id'=>$entry?->id,'entry_port'=>$entry ? $v['entry_port'] : null,'relay_verified_at'=>0,'tls_transition'=>null,'tls_transition_state'=>'none','credential_id'=>$c->id,'node_type'=>$v['node_type'],'node_id'=>$n->id,'domain'=>$domain,'family'=>$v['family'],'enabled'=>true,'managed'=>true,'published_domain'=>$n->host,'next_run'=>0,'status'=>'awaiting_report'];
            if ($old && $old->family!==$v['family']) $data+=['report_hash'=>null,'ipv4'=>null,'ipv6'=>null,'ipv4_seen_at'=>0,'ipv6_seen_at'=>0];
            $id=$old?$old->id:DB::table('v2_node_ddns')->insertGetId($data);
            if ($old) DB::table('v2_node_ddns')->where('id',$id)->update($data);
            $serverId=\App\Services\NetworkServer::attach($id,$v['server_id']??null);
            abort_if($entry && $entry->server_id==$serverId,422,'入口和回源应选择不同服务器');
            \App\Services\NodeListenerGuard::check($v['node_type'],\App\Services\ProxyService::model($v['node_type'])::findOrFail($n->id),$serverId);
            NodeDdnsService::event($id,'configuration_saved');
            return ['data'=>['id'=>$id,'domain'=>$domain]];
        });
    }
    public function manual(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','revision'=>'required|string|size:64','confirm'=>'required|accepted']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $a=DB::table('v2_node_ddns')->where('id',$v['id'])->lockForUpdate()->first();
            abort_unless($a && in_array($a->node_type,['v2box','v2node'],true) && $a->purpose!=='entry',422,'请选择有效的节点域名');
            abort_unless(hash_equals(self::revision($a),$v['revision']),409,'域名配置已变化，请重新载入后操作');
            $node=\App\Services\ProxyService::model($a->node_type)::find($a->node_id);
            abort_unless($node && !$node->service_id,422,'请选择有效的独立节点');
            abort_if($a->entry_id || $a->published_origin,409,'中转节点请先切换为直连并完成验证，再改为手动维护');
            \App\Services\ProxyService::assertUnused($a->node_type,(int)$a->node_id);
            \App\Services\NodeTlsTransition::reconcile($a);$a=DB::table('v2_node_ddns')->find($a->id);
            abort_if($a->tls_transition_state==='pending',409,'请先完成正在进行的证书验证');
            // Keep the physical server association and owned DNS records. No provider mutation.
            DB::table('v2_node_ddns')->where('id',$a->id)->update(['enabled'=>false,'managed'=>false,'status'=>'manual','next_run'=>-1,'tls_transition'=>null,'tls_transition_state'=>'none']);
            NodeDdnsService::event($a->id,'manual_address_enabled');
            return ['data'=>true];
        }));
    }
    public function activate(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','confirm'=>'required|accepted']);
        NodeDnsLifecycle::activate($v['id']); return ['data'=>true];
    }
    public function activateBatch(Request $request) {
        $v=$request->validate(['ids'=>'required|array|min:1|max:200','ids.*'=>'required|integer|min:1|distinct','confirm'=>'required|accepted']);
        $result=[];
        foreach ($v['ids'] as $id) {
            try { NodeDnsLifecycle::activate($id); $result[]=['id'=>$id,'success'=>true]; }
            catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { $result[]=['id'=>$id,'success'=>false,'message'=>$e->getMessage()]; }
        }
        return ['data'=>$result];
    }
    public function retry(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1']);
        return NodeDnsLifecycle::locked(function()use($v){
            DB::table('v2_node_ddns')->where('id',$v['id'])->where('managed',true)->update(['next_run'=>0,'status'=>'awaiting_report']);
            // Credential-wide limits are never reset here.
            return ['data'=>true];
        });
    }
    public function adopt(Request $request) {
        $v=$request->validate(['id'=>'required|integer|min:1','proof'=>'nullable|string|size:64']);
        return NodeDnsLifecycle::locked(function()use($v){
            $a=DB::table('v2_node_ddns')->find($v['id']);
            abort_unless($a && $a->managed && NodeDdnsService::nodeExists($a),422,'请选择托管节点绑定');
            $c=DB::table('v2_ddns_credential')->find($a->credential_id);
            abort_unless($c && $c->root_domain && str_ends_with($a->domain,'.'.$c->root_domain),422);
            $rows=[];
            try {
                foreach ($a->family==='dual'?['A','AAAA']:[$a->family==='ipv4'?'A':'AAAA'] as $type) {
                    $body=app(NodeDdnsService::class)->api($c,'GET','',['name'=>$a->domain,'type'=>$type,'per_page'=>100]);
                    $records=$body['result']??null;
                    abort_unless(is_array($records) && count($records)<=1 && ($body['result_info']['total_pages']??1)<=1,409,'同名记录不唯一');
                    if (!$records) continue;
                    $r=$records[0];
                    $owned=DB::table('v2_node_dns_record')->where('credential_id',$c->id)->where('domain',$a->domain)->where('type',$type)->first();
                    abort_unless(($r['name']??'')===$a->domain && ($r['type']??'')===$type && ($r['proxied']??null)===false && preg_match('/^[a-f0-9]{32}$/i',$r['id']??'') && NodeDdnsService::publicAddress($r['content']??'',$type==='A'?4:6),409,'仅可接管有效的 DNS-only 公网地址记录');
                    abort_if($owned && ($owned->assignment_id!=$a->id || $owned->delete_after),409,'记录已归属其他绑定或处于清理中');
                    abort_if(!empty($r['comment']) && (!$owned || $r['comment']!=='v2board:'.$owned->owner),409,'记录含其他归属备注，请先在 Cloudflare 核实');
                    $rows[]=$r;
                }
                $proof=hash('sha256',json_encode([$a->id,$a->credential_id,$a->domain,$a->family,$rows]));
                if (empty($v['proof'])) return ['data'=>['rows'=>array_map(fn($r)=>array_intersect_key($r,array_flip(['id','name','type','content'])),$rows),'proof'=>$proof]];
                abort_unless(hash_equals($proof,$v['proof']),409,'解析已变化，请重新预览');
                foreach ($rows as $r) {
                    $owned=DB::table('v2_node_dns_record')->where('credential_id',$c->id)->where('domain',$a->domain)->where('type',$r['type'])->first();
                    if (!$owned) {
                        $id=DB::table('v2_node_dns_record')->insertGetId(['credential_id'=>$c->id,'assignment_id'=>$a->id,'domain'=>$a->domain,'type'=>$r['type'],'owner'=>bin2hex(random_bytes(24))]);
                        $owned=DB::table('v2_node_dns_record')->find($id);
                    }
                    app(NodeDdnsService::class)->api($c,'PATCH','/'.$r['id'],['comment'=>'v2board:'.$owned->owner]);
                    DB::table('v2_node_dns_record')->where('id',$owned->id)->update(['record_id'=>$r['id'],'content'=>$r['content'],'status'=>'active']);
                }
                DB::table('v2_node_ddns')->where('id',$a->id)->update(['next_run'=>0,'status'=>'awaiting_report']);
                NodeDdnsService::event($a->id,'dns_adopted');
                return ['data'=>['adopted'=>count($rows)]];
            } catch (\App\Services\NodeDdnsFailure $e) { abort(422,'Cloudflare 接管失败：'.$e->getMessage()); }
        });
    }
    private function plan(int $from,int $to): array {
        abort_if($from===$to,422,'请选择不同的根域名');
        $a=DB::table('v2_ddns_credential')->find($from); $b=DB::table('v2_ddns_credential')->find($to);
        abort_unless($a && $a->root_domain && $b && $b->root_domain,422,'根域名尚未验证');
        $rows=DB::table('v2_node_ddns')->where('credential_id',$from)->orderBy('id')->get();
        abort_if($rows->count()>200,422,'单次最多迁移 200 个节点');
        $plan=[];
        foreach ($rows as $r) {
            abort_if($r->purpose==='entry' && (DB::table('v2_node_ddns')->where('entry_id',$r->id)->exists() || \App\Services\NodeConnection::referencesEntry($r->id)),409,'共享入口请在新根域名下新建入口，再逐个线路验证切换');
            abort_unless($r->managed && str_ends_with($r->domain,'.'.$a->root_domain),409,'存在未纳入托管的绑定，请先处理');
            abort_unless(NodeDdnsService::nodeExists($r),409,'请先清理已删除节点的绑定');
            $prefix=substr($r->domain,0,-strlen('.'.$a->root_domain));
            $domain=NodeDnsLifecycle::name($prefix,$b->root_domain);
            abort_if(DB::table('v2_node_ddns')->where('domain',$domain)->where('id','!=',$r->id)->exists() || DB::table('v2_node_dns_record')->where('domain',$domain)->where(fn($q)=>$q->where('assignment_id','!=',$r->id)->orWhere('delete_after','>',0))->exists(),409,'目标域名存在冲突或仍在清理中');
            $plan[]=['id'=>$r->id,'node_type'=>$r->node_type,'node_id'=>$r->node_id,'old'=>$r->domain,'new'=>$domain,'published'=>$r->published_domain,'published_origin'=>$r->published_origin,'family'=>$r->family];
        }
        return ['rows'=>$plan,'proof'=>hash('sha256',json_encode([$from,$to,$plan]))];
    }
    public function migrate(Request $request) {
        $v=$request->validate(['from'=>'required|integer|min:1','to'=>'required|integer|min:1','proof'=>'nullable|string|size:64']);
        return NodeDnsLifecycle::locked(function()use($v){
            $plan=$this->plan($v['from'],$v['to']);
            if (empty($v['proof'])) return ['data'=>$plan];
            abort_unless(hash_equals($plan['proof'],$v['proof']),409,'节点绑定已变化，请重新预览');
            DB::transaction(function()use($plan,$v){
                foreach ($plan['rows'] as $r) {
                    DB::table('v2_node_dns_record')->where('assignment_id',$r['id'])->where('domain','!=',$r['published'])->when($r['published_origin'],fn($q)=>$q->where('domain','!=',$r['published_origin']))->where('delete_after',0)->update(['delete_after'=>time()+1,'next_run'=>0,'status'=>'pending_cleanup']);
                    DB::table('v2_node_ddns')->where('id',$r['id'])->update(['credential_id'=>$v['to'],'domain'=>$r['new'],'next_run'=>0,'status'=>'awaiting_report']);
                    NodeDdnsService::event($r['id'],'domain_prepared');
                }
            });
            return ['data'=>$plan+['queued'=>true]];
        });
    }
    public function cleanup(Request $request) {
        $v=$request->validate(['id'=>'nullable|integer|min:1']);
        return NodeDnsLifecycle::locked(function()use($v){
            if (!empty($v['id'])) DB::table('v2_node_dns_record')->where('id',$v['id'])->where('delete_after','>',0)->update(['next_run'=>0]);
            foreach (DB::table('v2_node_ddns')->get(['id','node_type','node_id','purpose','server_id']) as $a) {
                if (!NodeDdnsService::nodeExists($a)) NodeDnsLifecycle::removeNode($a->node_type,$a->node_id);
            }
            NodeDnsLifecycle::retireOrphans();
            return ['data'=>DB::table('v2_node_dns_record')->where('delete_after','>',0)->orderBy('id')->limit(200)->get(['id','domain','type','content','status','delete_after','next_run'])];
        });
    }
    private function fingerprint(array $r): string {
        return hash('sha256',json_encode(array_intersect_key($r,array_flip(['id','name','type','content','proxied','comment','modified_on']))));
    }
    public function inspect(Request $request) {
        $v=$request->validate(['credential_id'=>'required|integer|min:1','page'=>'nullable|integer|min:1|max:10000']);
        $c=DB::table('v2_ddns_credential')->find($v['credential_id']); abort_unless($c && $c->root_domain,422,'根域名尚未验证');
        try { $body=app(NodeDdnsService::class)->api($c,'GET','',['page'=>$v['page']??1,'per_page'=>50]); }
        catch (\App\Services\NodeDdnsFailure $e) { abort(422,'Cloudflare 查询失败：'.$e->getMessage()); }
        $rows=[];
        foreach ($body['result']??[] as $r) {
            if (!in_array($r['type']??'',['A','AAAA'],true) || !str_ends_with($r['name']??'','.'. $c->root_domain) || str_contains($r['name'],'*')) continue;
            $used=NodeDnsLifecycle::inUse($r['name']);
            $managed=DB::table('v2_node_dns_record')->where('credential_id',$c->id)->where('domain',$r['name'])->where('type',$r['type'])->exists();
            // Unowned records are never automatically removed. A short-lived preview is mandatory.
            $token=null;
            if (!$used && !$managed && empty($r['comment']) && preg_match('/^[a-f0-9]{32}$/i',$r['id']??'')) {
                $token=bin2hex(random_bytes(24));
                Cache::put('dns-cleanup-preview:'.$token,['credential'=>$c->id,'record'=>$r['id'],'fingerprint'=>$this->fingerprint($r)],600);
            }
            $rows[]=['domain'=>$r['name'],'type'=>$r['type'],'content'=>$r['content'],'inUse'=>$used,'managed'=>$managed,'cleanupToken'=>$token];
        }
        return ['data'=>['rows'=>$rows,'pages'=>$body['result_info']['total_pages']??1]];
    }
    public function removeHistorical(Request $request) {
        $v=$request->validate(['token'=>'required|string|size:48','domain'=>'required|string|max:253','confirm'=>'required|accepted']);
        return NodeDnsLifecycle::locked(function()use($v){
            $p=Cache::get('dns-cleanup-preview:'.$v['token']); abort_unless($p,409,'预览已过期，请重新检查');
            $c=DB::table('v2_ddns_credential')->find($p['credential']); abort_unless($c,409);
            try {
                $r=app(NodeDdnsService::class)->api($c,'GET','/'.$p['record'])['result'];
                abort_unless($r && $r['name']===$v['domain'] && hash_equals($p['fingerprint'],$this->fingerprint($r)) && !NodeDnsLifecycle::inUse($r['name']),409,'记录已变化或仍被节点使用，请重新检查');
                abort_if(DB::table('v2_node_dns_record')->where('credential_id',$c->id)->where('domain',$r['name'])->exists(),409,'记录已纳入托管');
                app(NodeDdnsService::class)->api($c,'DELETE','/'.$p['record']);
            } catch (\App\Services\NodeDdnsFailure $e) { abort(422,'Cloudflare 删除失败：'.$e->getMessage()); }
            Cache::forget('dns-cleanup-preview:'.$v['token']); NodeDdnsService::event(0,'historical_dns_removed');
            return ['data'=>true];
        });
    }
}
