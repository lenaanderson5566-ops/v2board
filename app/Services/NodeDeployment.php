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
            abort_if($node->parent_id,422,'子节点使用父节点接入');
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
    public static function redeem(string $token): array {
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
                abort_unless($grant['expires']>time() && $node && !$node->parent_id && $actor && $actor->is_admin && !$actor->banned && hash_equals($grant['actorProof'],hash('sha256',(string)$actor->password)),403);
                abort_unless(hash_equals($grant['proof'],self::proof((int)$node->id)) && hash_equals($grant['host'],self::host()),409,'节点接入信息已变更，请重新生成命令');
                $networkOnly=!empty($grant['networkOnly']);
                $credential=$networkOnly ? null : NodeCredentials::issue('v2box',(int)$node->id,(int)$actor->id);
                $network=[];
                $binding=DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$node->id)->where('enabled',true)->lockForUpdate()->first();
                abort_if($networkOnly && !$binding,409,'节点域名绑定已停用，请重新生成命令');
                if ($binding) {
                    $reportToken=bin2hex(random_bytes(32));
                    DB::table('v2_node_ddns')->where('id',$binding->id)->update(['report_hash'=>hash('sha256',$reportToken)]+($networkOnly ? [] : ['next_run'=>0,'status'=>'awaiting_report','ipv4'=>null,'ipv6'=>null,'ipv4_seen_at'=>0,'ipv6_seen_at'=>0]));
                    $network=['networkReport'=>['token'=>$reportToken,'family'=>$binding->family]];
                    NodeDdnsService::event($binding->id,'report_key_rotated');
                }
                if ($networkOnly) return $network+['purpose'=>'network','nodeType'=>'v2box','nodeId'=>(int)$node->id,'apiHost'=>$grant['host']];
                $workflow=NodeDeploymentWorkflow::issue($node,$credential['id'],$grant);
                return $workflow+$network+['nodeType'=>'v2box','nodeId'=>(int)$node->id,'apiHost'=>$grant['host'],
                    'apiKey'=>$credential['secret'],'credentialId'=>$credential['id']];
            }));
        });
    }
}
