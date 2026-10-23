<?php
namespace App\Services;

use App\Models\ServerV2box;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Deployment grants contain no node key; credentials are issued only at redemption. */
final class NodeDeployment
{
    public const TTL = 600;
    private static function cache() { return Cache::store('node_deployment'); }
    private static function proof(int $id): string {
        return hash('sha256', json_encode([
            NodeCredentials::migrated('v2box',$id),
            NodeDeploymentWorkflow::snapshot(ServerV2box::findOrFail($id)),
            DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$id)->first(['id','credential_id','domain','family','enabled','report_hash']),
            DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$id)
                ->orderBy('id')->get(['id','revoked_at','expires_at'])->toArray(),
        ]));
    }
    public static function host(): string {
        $host=rtrim((string)(config('v2board.server_api_url') ?: config('v2board.app_url')), '/');
        $parts=parse_url($host);
        abort_unless($parts && ($parts['scheme']??'')==='https' && !empty($parts['host'])
            && !isset($parts['user']) && !isset($parts['pass'])
            && !isset($parts['query']) && !isset($parts['fragment']) && !preg_match('/[\s\x00-\x1f]/',$host),422,'请先设置有效的 HTTPS 节点 API 地址');
        return $host;
    }
    public static function create(int $id,int $actor,bool $networkOnly=false): array {
        $host=self::host();
        return self::cache()->lock('node:'.$id,15)->block(3,function()use($id,$actor,$host,$networkOnly){
            $node=ServerV2box::findOrFail($id);
            if ($networkOnly) {
                abort_unless(in_array(parse_url($host,PHP_URL_PATH),[null,'','/'],true),422,'IP 上报需要不带路径的 HTTPS 节点 API 地址');
                abort_unless(DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$id)->where('enabled',true)->exists(),422,'请先保存并启用节点域名绑定');
            } else NodeDeploymentWorkflow::validate($node);
            abort_if($node->service_id,422,'关联线路使用代理服务接入');
            abort_if(!$networkOnly && DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$id)
                ->whereNull('revoked_at')->where('expires_at','>',time())->exists(),409,'请先完成当前密钥轮换');
            $token='nd_'.bin2hex(random_bytes(32)); $hash=hash('sha256',$token);
            $key='grant:'.$hash; $index=($networkOnly?'latest-network:':'latest:').$id;
            if ($old=self::cache()->get($index)) self::cache()->forget('grant:'.$old);
            $expires=time()+self::TTL;
            abort_unless(self::cache()->put($key,['id'=>$id,'networkOnly'=>$networkOnly,'actor'=>$actor,'actorProof'=>hash('sha256',(string)User::findOrFail($actor)->password),'expires'=>$expires,'proof'=>self::proof($id),'host'=>$host],self::TTL),503);
            abort_unless(self::cache()->put($index,$hash,self::TTL),503);
            $quote=fn($v)=>"'".str_replace("'","'\\''",$v)."'";
            $command='wget -q -O install-v2box.sh '.$quote($host.'/api/v10/public/node-deployment/bootstrap').' && sh install-v2box.sh '.($networkOnly?'--network-only ':'').'--api-host '.$quote($host).' --node-id '.$id.' --deploy-token '.$quote($token);
            return ['command'=>$command,'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',$expires)];
        });
    }
    public static function createServer(int $id,int $actor): array {
        $host=self::host();
        abort_unless(in_array(parse_url($host,PHP_URL_PATH),[null,'','/'],true),422,'服务器上报地址不能包含路径');
        $s=DB::table('v2_network_server')->find($id);
        abort_unless($s && $s->enabled,422,'请选择已启用的服务器');
        $token='ns_'.bin2hex(random_bytes(32));$hash=hash('sha256',$token);$expires=time()+self::TTL;
        return self::cache()->lock('server:'.$id,15)->block(3,function()use($s,$id,$actor,$host,$token,$hash,$expires){
            if ($old=self::cache()->get('latest-server:'.$id)) self::cache()->forget('server-grant:'.$old);
            abort_unless(self::cache()->put('server-grant:'.$hash,['id'=>$id,'actor'=>$actor,'actorProof'=>hash('sha256',(string)User::findOrFail($actor)->password),'family'=>$s->family,'reportHash'=>$s->report_hash,'host'=>$host,'expires'=>$expires],self::TTL),503);
            abort_unless(self::cache()->put('latest-server:'.$id,$hash,self::TTL),503);
            $quote=fn($v)=>"'".str_replace("'","'\\''",$v)."'";
            return ['command'=>'wget -q -O install-v2box.sh '.$quote($host.'/api/v10/public/node-deployment/bootstrap').' && sh install-v2box.sh --server-id '.$id.' --api-host '.$quote($host).' --deploy-token '.$quote($token),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',$expires)];
        });
    }
    private static function redeemServer(string $token): array {
        $hash=hash('sha256',$token);$key='server-grant:'.$hash;$g=self::cache()->get($key);
        abort_unless(is_array($g),401,'服务器上报授权已失效');
        return self::cache()->lock('server:'.$g['id'],15)->block(3,function()use($key,$hash){
            $g=self::cache()->get($key);
            abort_unless($g && $g['expires']>time() && hash_equals((string)self::cache()->get('latest-server:'.$g['id']),$hash),401);
            abort_unless(self::cache()->forget($key),401);self::cache()->forget('latest-server:'.$g['id']);
            return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($g){
                $s=DB::table('v2_network_server')->where('id',$g['id'])->lockForUpdate()->first();$actor=User::find($g['actor']);
                abort_unless($s && $s->enabled && $actor && $actor->is_admin && !$actor->banned && hash_equals($g['actorProof'],hash('sha256',(string)$actor->password)),403);
                abort_unless($s->family===$g['family'] && $s->report_hash===$g['reportHash'] && self::host()===$g['host'],409,'服务器配置已变化，请重新生成命令');
                return ['purpose'=>'server','serverId'=>(int)$s->id,'apiHost'=>$g['host'],'networkReport'=>NetworkServer::credential($s->id)];
            }));
        });
    }
    public static function redeem(string $token): array {
        if (preg_match('/^ns_[a-f0-9]{64}$/D',$token)) return self::redeemServer($token);
        abort_unless(preg_match('/^nd_[a-f0-9]{64}$/D',$token),401,'部署授权无效或已过期');
        $hash=hash('sha256',$token); $key='grant:'.$hash;
        $grant=self::cache()->get($key);
        abort_unless(is_array($grant),401,'部署授权无效或已过期');
        return self::cache()->lock('node:'.$grant['id'],15)->block(3,function()use($key,$hash){
            $grant=self::cache()->get($key);
            $index=(!empty($grant['networkOnly'])?'latest-network:':'latest:').($grant['id']??0);
            abort_unless(is_array($grant) && $grant['expires']>time()
                && hash_equals((string)self::cache()->get($index),$hash),401,'部署授权已使用、撤销或过期');
            // Burn before issuing; a lost response must never allow a second redemption.
            abort_unless(self::cache()->forget($key),401);self::cache()->forget($index);
            return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($grant){
                $node=ServerV2box::whereKey($grant['id'])->lockForUpdate()->first();
                $actor=User::find($grant['actor']);
                abort_unless($grant['expires']>time() && $node && !$node->service_id && $actor && $actor->is_admin && !$actor->banned && hash_equals($grant['actorProof'],hash('sha256',(string)$actor->password)),403);
                abort_unless(hash_equals($grant['proof'],self::proof((int)$node->id)) && hash_equals($grant['host'],self::host()),409,'节点接入信息已变更，请重新生成命令');
                $networkOnly=!empty($grant['networkOnly']);
                $credential=$networkOnly ? null : NodeCredentials::issue('v2box',(int)$node->id,(int)$actor->id);
                $network=[];
                $binding=DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$node->id)->where('enabled',true)->lockForUpdate()->first();
                abort_if($networkOnly && !$binding,409,'节点域名绑定已停用，请重新生成命令');
                if ($binding) {
                    $serverId=NetworkServer::attach($binding->id);
                    $network=['networkReport'=>NetworkServer::credential($serverId)];
                }
                if ($networkOnly) return $network+['purpose'=>'network','nodeType'=>'v2box','nodeId'=>(int)$node->id,'apiHost'=>$grant['host']];
                $workflow=NodeDeploymentWorkflow::issue($node,$credential['id'],$grant);
                return $workflow+$network+['nodeType'=>'v2box','nodeId'=>(int)$node->id,'apiHost'=>$grant['host'],
                    'apiKey'=>$credential['secret'],'credentialId'=>$credential['id']];
            }));
        });
    }
}
