<?php
namespace App\Services;

use App\Models\ServerV2box;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Short-lived authority for one deployment, never a general node-management credential. */
final class NodeDeploymentWorkflow
{
    private const TTL=86400;
    private static function binding($node) { return DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$node->id)->where('enabled',true)->first(); }
    public static function snapshot($node): string {
        $a=self::binding($node);
        return hash('sha256',json_encode([$node->service_id,$node->protocol,$node->tls,$node->tls_settings,$node->server_port,$node->listen_ip,$node->network,$node->network_settings,
            $a?[$a->id,$a->credential_id,$a->domain,$a->family,$a->managed,$a->report_hash,$a->server_id,$a->entry_id,$a->entry_port,NetworkServer::target($a)->domain,DB::table('v2_network_server')->where('id',$a->server_id)->first(['family','report_hash','enabled'])]:null]));
    }
    public static function validate($node): void {
        $a=self::binding($node); $tls=$node->tls_settings?:[];
        if ((int)$node->tls===1 && in_array($tls['cert_mode']??'',['http','dns'],true)) {
            abort_unless($a && $a->managed,422,'自动申请证书的一键部署需要先保存托管节点域名');
        }
        if (!empty($tls['dns_credential_id'])) NodeCertificateCredential::credential($tls);
        if (!$a || !$a->managed) return;
        if ((int)$node->tls===1) {
            NetworkServer::tls($a,$tls);
            abort_unless(in_array($tls['cert_mode']??'',['http','dns','self','remote','file'],true),422,'请选择有效的 TLS 证书模式');
            abort_unless(is_string($tls['server_name']??null) && !empty($tls['server_name']) && !$node->disable_sni,422,'请设置独立 TLS 身份域名并启用 SNI');
            if (in_array($tls['cert_mode']??'',['http','dns'],true)) {
                abort_unless(preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',$tls['server_name']),422,'自动申请证书需要有效的单个域名');
                abort_if(($tls['cert_mode']??'')==='http' && (int)$node->server_port===80,422,'HTTP 证书验证需要独立的 80 端口，请调整节点监听端口');
                abort_if(($tls['cert_mode']??'')==='dns' && empty($tls['dns_credential_id']) && (empty($tls['provider']) || empty($tls['dns_env'])),422,'DNS 申请证书需要单独配置 DNS 提供商和验证凭据');
            }
        }
    }
    public static function issue($node,string $credential,array $grant): array {
        $a=self::binding($node);
        if (!$a || !$a->managed) return [];
        self::validate($node);
        $token='dp_'.bin2hex(random_bytes(32));$tls=$node->tls_settings?:[];
        $data=['nodeId'=>(int)$node->id,'credential'=>$credential,'actor'=>$grant['actor'],'actorProof'=>$grant['actorProof'],
            'proof'=>self::snapshot($node),'expires'=>time()+self::TTL,'startedAt'=>null,'completed'=>false];
        abort_unless(Cache::store('node_deployment')->put('workflow:'.hash('sha256',$token),$data,self::TTL),503);
        return ['deployment'=>['accessMode'=>$a->entry_id?'relay':'direct','connectionDomain'=>NetworkServer::target($a)->domain,'token'=>$token,'domain'=>$a->domain,'tls'=>(int)$node->tls,'certificateMode'=>$tls['cert_mode']??'',
            'certificateDomain'=>$tls['server_name']??'','certificateFile'=>$tls['cert_file']??'',
            'protocol'=>$node->protocol,'listenPort'=>(int)$node->server_port,'listenAddress'=>$node->listen_ip?:'0.0.0.0']];
    }
    public static function progress(string $token,string $action,?array $dns=null): array {
        abort_unless(preg_match('/^dp_[a-f0-9]{64}$/D',$token),401);
        $operation=function()use($token,$action,$dns){
            $cache=Cache::store('node_deployment');$key='workflow:'.hash('sha256',$token);$w=$cache->get($key);
            abort_unless($w && $w['expires']>time(),401,'部署恢复授权已过期，请在后台重新配置');
            $node=ServerV2box::find($w['nodeId']);$actor=User::find($w['actor']);$cred=DB::table('v2_node_credential')->find($w['credential']);
            abort_unless($node && !$node->service_id && $actor && $actor->is_admin && !$actor->banned && hash_equals($w['actorProof'],hash('sha256',(string)$actor->password)) && $cred && !$cred->revoked_at && (!$cred->expires_at || $cred->expires_at>time()),403,'部署授权已撤销');
            abort_unless(hash_equals($w['proof'],self::snapshot($node)),409,'节点或域名配置已变化，请核对后重新部署');
            if ($dns) Cache::put('NODE_DEPLOY_DNS:'.$node->id,$dns+['checkedAt'=>time()],180);
            if ($w['completed']) return ['completed'=>true,'dnsReady'=>true,'applicationState'=>'applied','errorCode'=>null,'addresses'=>(object)[]];
            $a=self::binding($node);
            // Enrollment is a scoped POST. Progress can advance one due binding even
            // when cron is unavailable; sync retains the provider pause/backoff and lock.
            if ($action==='status') {
                foreach (array_unique([$a->id,NetworkServer::target($a)->id]) as $id) {
                    $pending=DB::table('v2_node_ddns')->find($id);
                    if (!$pending) continue;
                    $provider=DB::table('v2_ddns_credential')->find($pending->credential_id);
                    if ($pending->next_run>=0 && $pending->next_run<=time() && $provider && $provider->next_run>=0 && $provider->next_run<=time()) {
                        try { app(NodeDnsLifecycle::class)->sync((int)$id); }
                        catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { if ($e->getStatusCode()!==409) throw $e; }
                        break;
                    }
                }
                $node->refresh();
                abort_unless(hash_equals($w['proof'],self::snapshot($node)),409,'节点或域名配置已变化，请核对后重新部署');
                $a=self::binding($node);
            }
            $addresses=[];$ready=NetworkServer::ready($a) && NetworkServer::ready(NetworkServer::target($a));
            foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) {
                $ip=$a->$family;
                $ready=$ready && $ip && $a->{$family.'_seen_at'}>=time()-900 && DB::table('v2_node_dns_record')->where('assignment_id',$a->id)->where('credential_id',$a->credential_id)->where('domain',$a->domain)->where('type',$family==='ipv4'?'A':'AAAA')->where('content',$ip)->whereNotNull('record_id')->where('status','active')->where('delete_after',0)->exists();
                if ($ip) $addresses[$family]=$ip;
            }
            if ($action==='start') {
                abort_unless($ready,409,'解析尚未同步');
                if (!$w['startedAt']) { Cache::forget("NODE_CONFIG_RECEIPT:v2box:{$node->id}");$w['startedAt']=time();$cache->put($key,$w,$w['expires']-time()); }
            }
            $runtime=NodeRuntimeService::inspect('v2box',$node);
            $applied=$w['startedAt'] && ($cred->last_used_at??0)>=$w['startedAt'] && $runtime['applicationState']==='applied' && ($runtime['lastAppliedAt']??0)>=$w['startedAt'] && ($runtime['lastCheckAt']??0)>=time()-180 && ($runtime['providedAt']??0)>=$w['startedAt'];
            if ($action==='complete') {
                abort_unless($ready && $applied,409,'节点尚未确认应用当前配置');
                $receipt=Cache::get("NODE_CONFIG_RECEIPT:v2box:{$node->id}",[]);
                NodeDnsLifecycle::activateLocked($a->id,true,null,$receipt['certificateFingerprint']??null);
                $w['proof']=self::snapshot($node->fresh());
                $w['completed']=true;$cache->put($key,$w,$w['expires']-time());
            }
            return ['completed'=>$w['completed'],'dnsReady'=>(bool)$ready,'addresses'=>(object)$addresses,'entryAddresses'=>(object)NetworkServer::addresses(NetworkServer::target($a)),
                'dnsChecks'=>array_values(array_filter([self::dnsCheck($a,'origin'),$a->entry_id?self::dnsCheck(NetworkServer::target($a),'entry'):null])),
                'applicationState'=>$applied?'applied':($runtime['applicationState']==='failed'?'failed':'unconfirmed'),
                'errorCode'=>$runtime['errorCode'],'dnsStatus'=>$a->status];
        };
        if ($action==='status') return $operation();
        try { return NodeDnsLifecycle::locked($operation); }
        catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            if ($e->getStatusCode()===409 && $e->getMessage()==='域名操作正在执行，请稍后重试') abort(503,'部署操作暂忙，请稍后重试');
            throw $e;
        }
    }

    public static function dnsCheck($a,string $role): array {
        $server=DB::table('v2_network_server')->find($a->server_id);
        $provider=DB::table('v2_ddns_credential')->find($a->credential_id);
        $missing=[];
        foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) {
            if (!$a->$family || $a->{$family.'_seen_at'}<time()-900) $missing[]=$family;
        }
        $reason=NetworkServer::ready($a)?'ready':'dns_pending';
        if (!$server || !$server->enabled || !$a->enabled) $reason='disabled';
        elseif ($missing) $reason='awaiting_report';
        elseif (!$provider || $provider->next_run<0 || $a->next_run<0) $reason='sync_blocked';
        elseif ($provider->next_run>time()) $reason='provider_backoff';
        return ['role'=>$role,'domain'=>$a->domain,'serverId'=>(int)$a->server_id,'reason'=>$reason,
            'status'=>$a->status,'providerStatus'=>$provider->status??'missing','missingFamilies'=>$missing,
            'retryAfter'=>max(0,(int)$a->next_run-time(),(int)($provider->next_run??0)-time())];
    }
}
