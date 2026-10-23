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
        return hash('sha256',json_encode([$node->parent_id,$node->protocol,$node->tls,$node->tls_settings,$node->server_port,$node->listen_ip,$node->network,$node->network_settings,
            $a?[$a->id,$a->credential_id,$a->domain,$a->family,$a->managed,$a->report_hash]:null]));
    }
    public static function validate($node): void {
        $a=self::binding($node); $tls=$node->tls_settings?:[];
        if ((int)$node->tls===1 && in_array($tls['cert_mode']??'',['http','dns'],true)) {
            abort_unless($a && $a->managed,422,'自动申请证书的一键部署需要先保存托管节点域名');
        }
        if (!$a || !$a->managed) return;
        if ((int)$node->tls===1) {
            abort_unless(in_array($tls['cert_mode']??'',['http','dns','self','remote','file'],true),422,'请选择有效的 TLS 证书模式');
            abort_unless(($tls['server_name']??'')===$a->domain,422,'一键部署的 TLS 服务器名称须与托管节点域名一致；已运行节点请先使用域名切换验证证书');
            if (in_array($tls['cert_mode']??'',['http','dns'],true)) {
                abort_unless(preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',$tls['server_name']),422,'自动申请证书需要有效的单个域名');
                abort_if(($tls['cert_mode']??'')==='http' && (int)$node->server_port===80,422,'HTTP 证书验证需要独立的 80 端口，请调整节点监听端口');
                abort_if(($tls['cert_mode']??'')==='dns' && (empty($tls['provider']) || empty($tls['dns_env'])),422,'DNS 申请证书需要单独配置 DNS 提供商和验证凭据');
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
        return ['deployment'=>['token'=>$token,'domain'=>$a->domain,'tls'=>(int)$node->tls,'certificateMode'=>$tls['cert_mode']??'',
            'certificateDomain'=>$tls['server_name']??'','certificateFile'=>$tls['cert_file']??'',
            'protocol'=>$node->protocol,'listenPort'=>(int)$node->server_port,'listenAddress'=>$node->listen_ip?:'0.0.0.0']];
    }
    public static function progress(string $token,string $action): array {
        abort_unless(preg_match('/^dp_[a-f0-9]{64}$/D',$token),401);
        $operation=function()use($token,$action){
            $cache=Cache::store('node_deployment');$key='workflow:'.hash('sha256',$token);$w=$cache->get($key);
            abort_unless($w && $w['expires']>time(),401,'部署恢复授权已过期，请在后台重新配置');
            $node=ServerV2box::find($w['nodeId']);$actor=User::find($w['actor']);$cred=DB::table('v2_node_credential')->find($w['credential']);
            abort_unless($node && !$node->parent_id && $actor && $actor->is_admin && !$actor->banned && hash_equals($w['actorProof'],hash('sha256',(string)$actor->password)) && $cred && !$cred->revoked_at && (!$cred->expires_at || $cred->expires_at>time()),403,'部署授权已撤销');
            abort_unless(hash_equals($w['proof'],self::snapshot($node)),409,'节点或域名配置已变化，请核对后重新部署');
            if ($w['completed']) return ['completed'=>true,'dnsReady'=>true,'applicationState'=>'applied','errorCode'=>null,'addresses'=>(object)[]];
            $a=self::binding($node);$addresses=[];$ready=in_array($a->status,['healthy','ready_to_switch'],true);
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
            return ['completed'=>$w['completed'],'dnsReady'=>(bool)$ready,'addresses'=>(object)$addresses,
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
}
