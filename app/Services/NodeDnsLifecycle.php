<?php
namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** DNS-only records with a durable ownership ledger. No provider calls on node traffic paths. */
final class NodeDnsLifecycle
{
    public static function locked(callable $fn) {
        // One bounded worker; administrative edits share this lock, not an open SQL transaction.
        try { return Cache::lock('node-dns-lifecycle',120)->block(2,$fn); }
        catch (\Illuminate\Contracts\Cache\LockTimeoutException $e) { abort(409,'域名操作正在执行，请稍后重试'); }
    }
    private function api($c,string $method,string $path='',array $data=[]): array {
        return app(NodeDdnsService::class)->api($c,$method,$path,$data);
    }
    public static function name(string $prefix,string $root): string {
        abort_unless(preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/D',$prefix),422,'子域名仅支持小写字母、数字和连字符');
        abort_unless($root && strlen($prefix.'.'.$root)<=253,422,'请先验证根域名');
        return $prefix.'.'.$root;
    }
    public static function retire(int $id,int $delay=0): void {
        DB::table('v2_node_dns_record')->where('assignment_id',$id)->where('delete_after',0)
            ->update(['delete_after'=>time()+max(1,$delay),'next_run'=>0,'status'=>'pending_cleanup']);
    }
    public static function removeNode(string $type,int $id): void {
        $a=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$id)->first();
        if (!$a) return;
        self::retire($a->id);
        DB::table('v2_node_ddns')->where('id',$a->id)->delete();
        NodeDdnsService::event($a->id,'configuration_removed');
    }
    public static function retireOrphans(): void {
        // Recover interrupted/manual binding removals without contacting the provider.
        DB::table('v2_node_dns_record')->where('delete_after',0)->whereNotIn('assignment_id',DB::table('v2_node_ddns')->select('id'))
            ->update(['delete_after'=>time()+1,'next_run'=>0,'status'=>'pending_cleanup']);
    }
    public static function inUse(string $domain, ?int $ignorePublishedOrigin = null): bool {
        if (NodeConnection::inUse($domain)) return true;
        foreach (['v2box'] as $type) {
            if (DB::table('v2_server_'.$type)->where(fn($q)=>$q->where('host',$domain)->orWhere('tls_settings->server_name',$domain))->exists()) return true;
        }
        return DB::table('v2_node_ddns')->where('domain',$domain)->orWhere(function($q)use($domain,$ignorePublishedOrigin){
            $q->where('published_origin',$domain);
            if($ignorePublishedOrigin!==null) $q->where('id','!=',$ignorePublishedOrigin);
        })->exists();
    }
    private function ensure($c,$a,string $type,string $ip): void {
        $r=DB::table('v2_node_dns_record')->where('credential_id',$c->id)->where('domain',$a->domain)->where('type',$type)->first();
        if ($r && ($r->assignment_id!=$a->id || $r->delete_after)) throw new NodeDdnsFailure('ownership_conflict',0,-1);
        if (!$r) {
            $id=DB::table('v2_node_dns_record')->insertGetId(['assignment_id'=>$a->id,'credential_id'=>$c->id,'domain'=>$a->domain,'type'=>$type,'owner'=>bin2hex(random_bytes(24))]);
            $r=DB::table('v2_node_dns_record')->find($id);
        }
        $marker='v2board:'.$r->owner;
        $body=$this->api($c,'GET','',['name'=>$a->domain,'type'=>$type,'per_page'=>100]);
        $records=$body['result'] ?? null;
        if (!is_array($records) || count($records)>1 || ($body['result_info']['total_pages']??1)>1) throw new NodeDdnsFailure('ambiguous_records',0,-1);
        $remote=$records[0]??null;
        if ($remote && (($r->record_id && ($remote['id']??'')!==$r->record_id) || ($remote['comment']??'')!==$marker || ($remote['name']??'')!==$a->domain || ($remote['type']??'')!==$type || !preg_match('/^[a-f0-9]{32}$/i',$remote['id']??''))) throw new NodeDdnsFailure('ownership_conflict',0,-1);
        if (!$remote || ($remote['content']??'')!==$ip || ($remote['proxied']??null)!==false) {
            $body=$this->api($c,$remote?'PATCH':'POST',$remote?'/'.$remote['id']:'',['name'=>$a->domain,'type'=>$type,'content'=>$ip,'ttl'=>300,'proxied'=>false,'comment'=>$marker]);
            $remote=$body['result']??null;
            if (!is_array($remote) || !preg_match('/^[a-f0-9]{32}$/i',$remote['id']??'') || ($remote['comment']??'')!==$marker || ($remote['name']??'')!==$a->domain || ($remote['type']??'')!==$type || ($remote['content']??'')!==$ip || ($remote['proxied']??null)!==false) throw new NodeDdnsFailure('unexpected_record');
            NodeDdnsService::event($a->id,'dns_updated');
        }
        DB::table('v2_node_dns_record')->where('id',$r->id)->update(['record_id'=>$remote['id'],'content'=>$ip,'status'=>'active']);
    }
    public function sync(int $id): void {
        self::locked(function()use($id){
            $a=DB::table('v2_node_ddns')->find($id);
            if (!$a || !$a->enabled || !$a->managed || $a->next_run<0 || $a->next_run>time()) return;
            if ($a->purpose!=='entry') NodeTlsTransition::reconcile($a);
            if ($a->server_id && !DB::table('v2_network_server')->where('id',$a->server_id)->where('enabled',true)->exists()) return;
            $c=DB::table('v2_ddns_credential')->find($a->credential_id);
            if (!$c || $c->next_run<0 || $c->next_run>time()) return;
            $status='healthy'; $next=time()+300;
            try {
                if (!NodeDdnsService::nodeExists($a)) { self::removeNode($a->node_type,$a->node_id); return; }
                $host=$a->purpose==='entry' ? $a->domain : DB::table('v2_server_'.$a->node_type)->where('id',$a->node_id)->value('host');
                if ($host!==$a->published_domain && $host!==NetworkServer::target($a)->domain) throw new NodeDdnsFailure('host_changed',0,-1);
                foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) {
                    if (!$a->$family || $a->{$family.'_seen_at'}<time()-900) { $status='awaiting_report'; continue; }
                    $this->ensure($c,$a,$family==='ipv4'?'A':'AAAA',$a->$family);
                }
                if ($status==='healthy' && $a->purpose!=='entry' && $a->published_domain!==NetworkServer::target($a)->domain) $status='ready_to_switch';
                if ($status!=='awaiting_report') DB::table('v2_node_ddns')->where('id',$id)->update(['last_success'=>time()]);
                DB::table('v2_ddns_credential')->where('id',$c->id)->update(['status'=>'ready','next_run'=>0]);
            } catch (NodeDdnsFailure $e) {
                $status=$e->getMessage(); $next=$e->delay<0?-1:time()+$e->delay;
                if ($e->credential) DB::table('v2_ddns_credential')->where('id',$c->id)->update(['status'=>$status,'next_run'=>$next]);
            }
            DB::table('v2_node_ddns')->where('id',$id)->update(['status'=>$status,'next_run'=>$next]);
            if ($a->status!==$status) NodeDdnsService::event($id,$status);
        });
    }
    public static function activate(int $id): void {
        self::locked(fn()=>self::activateLocked($id));
    }
    /** Caller must hold the DNS lifecycle lock. */
    public static function activateLocked(int $id,bool $verified=false,?array $candidate=null,?string $fingerprint=null): void {
        DB::transaction(function()use($id,$verified,$candidate,$fingerprint){
            $a=DB::table('v2_node_ddns')->where('id',$id)->lockForUpdate()->first();
            abort_unless($a && $a->managed && NetworkServer::ready($a),409,'请等待所属服务器启用、有效 IP 上报及解析同步成功');
            abort_if($a->purpose==='entry',422,'入口域名由引用它的节点分别启用');
            $target=NetworkServer::target($a);
            abort_unless(NetworkServer::ready($target),409,'入口解析尚未就绪');
            $table='v2_server_'.$a->node_type;
            $node=DB::table($table)->where('id',$a->node_id)->lockForUpdate()->first();
            abort_unless($node && ($node->host===$a->published_domain || $node->host===$target->domain),409,'节点地址已变化，请重新保存域名绑定');
            // Preserve managed connection endpoints; only update the default endpoint and imported aliases.
            $affected=NodeTlsTransition::affected($a);
            if (!$verified && $affected->contains(fn($n)=>(int)$n->tls===1)) {
                NodeTlsTransition::queue($a,$node,$affected); return;
            }
            $connectionPort=$a->entry_id ? $a->entry_port : $node->server_port;
            if(!$verified && !$a->entry_id && $node->host===$target->domain && (int)$node->port!==(int)$connectionPort){
                $runtime=NodeRuntimeService::inspect($a->node_type,ProxyService::model($a->node_type)::findOrFail($node->id));
                abort_unless(($runtime['applicationState']==='applied') && $runtime['runtimeStatus']==='online',409,'请等待节点应用新的监听端口后再切换连接端口');
            }
            foreach ($affected as $n) {
                $update=['host'=>$target->domain,'updated_at'=>time()];
                if($a->entry_id || $a->published_origin || (int)$n->id===(int)$node->id || (string)$n->port===(string)$node->port) $update['port']=$connectionPort;
                if ((int)$n->tls===1) {
                    $tls=json_decode($n->tls_settings??'{}',true)?:[];
                    $identity=$candidate ?? $tls;
                    abort_unless(!empty($identity['server_name']) && preg_match('/^[a-f0-9]{64}$/D',$fingerprint??''),409,'节点尚未验证目标域名的证书');
                    $tls=$identity;
                    if (!empty($tls['dns_credential_id'])) NodeCertificateCredential::credential($tls);
                    unset($tls['server_names'],$tls['pinned_peer_cert_sha256']);
                    if (in_array($tls['cert_mode'],['self','remote'],true)) $tls['pinned_peer_cert_sha256']=$fingerprint;
                    $update['tls_settings']=json_encode($tls);
                }
                DB::table($table)->where('id',$n->id)->update($update);
            }
            // Relay origin records are retired only through an explicit cleanup preview.
            if (!$a->entry_id) DB::table('v2_node_dns_record')->where('assignment_id',$id)->where('delete_after',0)->where('domain','!=',$a->domain)->update(['delete_after'=>time()+86400,'next_run'=>0,'status'=>'pending_cleanup']);
            DB::table('v2_node_ddns')->where('id',$id)->update(['published_domain'=>$target->domain,'published_port'=>$connectionPort,'published_origin'=>$a->entry_id?($a->published_origin?:$a->domain):null,'relay_verified_at'=>0,'status'=>'healthy','tls_transition'=>null,'tls_transition_state'=>$verified?'applied':'none']);
            NodeDdnsService::event($id,'domain_activated');
        });
    }
    /** Caller holds the lifecycle lock. Preview never changes DNS or node configuration. */
    public static function originCleanupPlan(int $id): array {
        $a=DB::table('v2_node_ddns')->find($id);
        abort_unless($a && $a->managed && $a->entry_id && NetworkServer::ready($a) && NetworkServer::ready(NetworkServer::target($a)) && $a->published_domain===NetworkServer::target($a)->domain && (int)$a->published_port===(int)$a->entry_port && $a->tls_transition_state!=='pending',409,'请先完成当前域名与节点证书验证');
        $records=DB::table('v2_node_dns_record')->where('assignment_id',$id)->where('domain','!=',$a->domain)->where('delete_after',0)->orderBy('id')->get();
        $rows=$records->map(function($r)use($id){
            $blocked=self::inUse($r->domain,$id);
            return ['id'=>(int)$r->id,'domain'=>$r->domain,'type'=>$r->type,'ip'=>$r->content,'action'=>$blocked?'blocked':'schedule','reason'=>$blocked?'仍被节点、证书或其他域名绑定引用':'确认后保留 24 小时，再由后台安全清理'];
        })->all();
        $identity=array_intersect_key((array)$a,array_flip(['id','entry_id','domain','published_origin','published_domain','published_port','entry_port','credential_id','node_type','node_id','server_id','family','tls_transition_state']));
        return ['rows'=>$rows,'proof'=>hash('sha256',json_encode([$identity,$records,$rows]))];
    }
    public static function previewOriginCleanup(int $id): array {
        return self::locked(function()use($id){
            $plan=self::originCleanupPlan($id);
            Cache::put('origin-cleanup-preview:'.$plan['proof'],true,600);
            return $plan;
        });
    }
    public static function scheduleOriginCleanup(int $id,string $proof): array {
        return self::locked(fn()=>DB::transaction(function()use($id,$proof){
            $plan=self::originCleanupPlan($id);
            abort_unless(hash_equals($plan['proof'],$proof) && Cache::get('origin-cleanup-preview:'.$proof),409,'预览已过期或域名记录已变化，请重新预览');
            $ids=array_column(array_filter($plan['rows'],fn($r)=>$r['action']==='schedule'),'id');
            abort_unless($ids,409,'没有可清理的旧回源解析');
            $a=DB::table('v2_node_ddns')->find($id);
            $domains=array_column(array_filter($plan['rows'],fn($r)=>in_array($r['id'],$ids,true)),'domain');
            if(in_array($a->published_origin,$domains,true)) DB::table('v2_node_ddns')->where('id',$id)->update(['published_origin'=>$a->domain]);
            $after=time()+86400;
            DB::table('v2_node_dns_record')->where('assignment_id',$id)->whereIn('id',$ids)->where('delete_after',0)->update(['delete_after'=>$after,'next_run'=>0,'status'=>'pending_cleanup']);
            NodeDdnsService::event($id,'origin_cleanup_scheduled');
            Cache::forget('origin-cleanup-preview:'.$proof);
            return ['scheduled'=>count($ids),'deleteAfter'=>$after];
        }));
    }
    public function cleanup(int $id): void {
        self::locked(function()use($id){
            $r=DB::table('v2_node_dns_record')->find($id);
            if (!$r || !$r->delete_after || $r->delete_after>time() || $r->next_run<0 || $r->next_run>time()) return;
            $c=DB::table('v2_ddns_credential')->find($r->credential_id);
            if (!$c || $c->next_run<0 || $c->next_run>time()) return;
            try {
                if (self::inUse($r->domain)) throw new NodeDdnsFailure('still_in_use',0,3600);
                // Recover a successful POST whose response was lost before record_id was persisted.
                if (!$r->record_id) {
                    $body=$this->api($c,'GET','',['name'=>$r->domain,'type'=>$r->type,'per_page'=>100]);
                    $rows=$body['result']??null;
                    if (!is_array($rows) || count($rows)>1 || ($body['result_info']['total_pages']??1)>1) throw new NodeDdnsFailure('ambiguous_records',0,-1);
                    $remote=$rows[0]??null;
                } else $remote=$this->api($c,'GET','/'.$r->record_id)['result'];
                if ($remote) {
                    if (($r->record_id && ($remote['id']??'')!==$r->record_id) || ($remote['comment']??'')!=='v2board:'.$r->owner || ($remote['name']??'')!==$r->domain || ($remote['type']??'')!==$r->type || ($remote['proxied']??null)!==false || ($r->content!==null && ($remote['content']??'')!==$r->content) || !preg_match('/^[a-f0-9]{32}$/i',$remote['id']??'')) throw new NodeDdnsFailure('ownership_conflict',0,-1);
                    $this->api($c,'DELETE','/'.$remote['id']);
                }
                DB::table('v2_node_dns_record')->where('id',$id)->delete();
                NodeDdnsService::event($r->assignment_id,'dns_removed');
            } catch (NodeDdnsFailure $e) {
                $next=$e->delay<0?-1:time()+$e->delay;
                DB::table('v2_node_dns_record')->where('id',$id)->update(['status'=>$e->getMessage(),'next_run'=>$next]);
                if ($e->credential) DB::table('v2_ddns_credential')->where('id',$c->id)->update(['status'=>$e->getMessage(),'next_run'=>$next]);
            }
        });
    }
}
