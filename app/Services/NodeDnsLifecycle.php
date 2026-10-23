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
    public static function inUse(string $domain): bool {
        foreach (['v2node','v2box'] as $type) {
            if (DB::table('v2_server_'.$type)->where(fn($q)=>$q->where('host',$domain)->orWhere('tls_settings->server_name',$domain))->exists()) return true;
        }
        return DB::table('v2_node_ddns')->where('domain',$domain)->exists();
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
            $c=DB::table('v2_ddns_credential')->find($a->credential_id);
            if (!$c || $c->next_run<0 || $c->next_run>time()) return;
            $status='healthy'; $next=time()+300;
            try {
                if (!NodeDdnsService::nodeExists($a)) { self::removeNode($a->node_type,$a->node_id); return; }
                $host=DB::table('v2_server_'.$a->node_type)->where('id',$a->node_id)->value('host');
                if ($host!==$a->published_domain && $host!==$a->domain) throw new NodeDdnsFailure('host_changed',0,-1);
                foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) {
                    if (!$a->$family || $a->{$family.'_seen_at'}<time()-900) { $status='awaiting_report'; continue; }
                    $this->ensure($c,$a,$family==='ipv4'?'A':'AAAA',$a->$family);
                }
                if ($status==='healthy' && $a->published_domain!==$a->domain) $status='ready_to_switch';
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
        self::locked(fn()=>DB::transaction(function()use($id){
            $a=DB::table('v2_node_ddns')->where('id',$id)->lockForUpdate()->first();
            abort_unless($a && $a->managed && $a->enabled && in_array($a->status,['ready_to_switch','healthy'],true) && $a->last_success>=time()-900,409,'请等待有效 IP 上报及解析同步成功');
            foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) {
                abort_unless($a->$family && $a->{$family.'_seen_at'}>=time()-900 && DB::table('v2_node_dns_record')->where('assignment_id',$id)->where('credential_id',$a->credential_id)->where('domain',$a->domain)->where('type',$family==='ipv4'?'A':'AAAA')->where('content',$a->$family)->whereNotNull('record_id')->where('status','active')->where('delete_after',0)->exists(),409,'最新上报地址尚未同步，请等待解析就绪');
            }
            $table='v2_server_'.$a->node_type;
            $node=DB::table($table)->where('id',$a->node_id)->lockForUpdate()->first();
            abort_unless($node && ($node->host===$a->published_domain || $node->host===$a->domain),409,'节点地址已变化，请重新保存域名绑定');
            // Only the selected node and its direct children sharing the old hostname are changed.
            $affected=DB::table($table)->where(fn($q)=>$q->where('id',$a->node_id)->orWhere('parent_id',$a->node_id))->where('host',$node->host)->get();
            foreach ($affected as $n) {
                $tls=json_decode($n->tls_settings??'{}',true)?:[];
                abort_if((int)$n->tls===1 && empty($tls['server_name']),422,'TLS 节点须先设置并验证独立的证书名称，再切换连接域名');
            }
            DB::table($table)->whereIn('id',$affected->pluck('id'))->update(['host'=>$a->domain,'updated_at'=>time()]);
            DB::table('v2_node_dns_record')->where('assignment_id',$id)->where('delete_after',0)->where('domain','!=',$a->domain)->update(['delete_after'=>time()+86400,'next_run'=>0,'status'=>'pending_cleanup']);
            DB::table('v2_node_ddns')->where('id',$id)->update(['published_domain'=>$a->domain,'status'=>'healthy']);
            NodeDdnsService::event($id,'domain_activated');
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
