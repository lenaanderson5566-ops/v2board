<?php
namespace App\Services;

use App\Models\ServerV2box;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Short-lived migration authority never issues or rotates node/report credentials. */
final class NodeApiMigration
{
    private static function cache() { return Cache::store('node_deployment'); }
    public static function origin(string $host): string {
        $p=parse_url($host);
        abort_unless($p && ($p['scheme']??'')==='https' && !empty($p['host'])
            && !isset($p['user']) && !isset($p['pass']) && !isset($p['query']) && !isset($p['fragment'])
            && in_array($p['path']??'',['','/'],true) && !preg_match('/[\s\x00-\x1f]/',$host),422,'迁移需要不带路径的 HTTPS 节点 API 地址');
        return 'https://'.strtolower($p['host']).(isset($p['port']) && $p['port']!==443?':'.$p['port']:'');
    }
    private static function proof(int $id): string {
        $node=ServerV2box::findOrFail($id);
        $migrated=NodeCredentials::migrated('v2box',$id);
        return hash('sha256',json_encode([NodeDeploymentWorkflow::snapshot($node),$migrated,
            $migrated?null:[NodeCredentials::legacyEnabled(),hash('sha256',(string)config('v2board.server_token'))],
            DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$id)->orderBy('id')->get(['id','revoked_at','expires_at'])->toArray()]));
    }
    public static function create(int $id,int $actor,string $from,bool $serverOnly=false): array {
        $from=self::origin($from);$to=self::origin(NodeDeployment::host());
        abort_if($from===$to,422,'新旧节点 API 地址相同');
        if($serverOnly) {
            $server=DB::table('v2_network_server')->find($id);
            abort_unless($server && $server->enabled && $server->report_hash,422,'请先配置该服务器的 IP 上报');
        } else {
            $node=ServerV2box::findOrFail($id);abort_if($node->service_id,422,'请选择独立代理服务');
        }
        $proofs=[];
        if(!$serverOnly) foreach(ServerV2box::whereNull('service_id')->orWhere('service_id',0)->pluck('id') as $nodeId) $proofs[$nodeId]=self::proof((int)$nodeId);
        $token='am_'.bin2hex(random_bytes(32));$expires=time()+3600;
        abort_unless(self::cache()->put('api-migration:'.hash('sha256',$token),['from'=>$from,'to'=>$to,'nodeId'=>$serverOnly?null:$id,'proofs'=>$proofs,
            'serverId'=>$serverOnly?$id:null,'serverProof'=>$serverOnly?hash('sha256',json_encode([$server->report_hash,$server->family,$server->enabled])):null,
            'actor'=>$actor,'actorProof'=>hash('sha256',(string)User::findOrFail($actor)->password),'expires'=>$expires],3600),503);
        $q=fn($s)=>"'".str_replace("'","'\\''",$s)."'";
        return ['command'=>'wget --https-only -O install-v2box.sh '.$q($to.'/api/v10/public/node-deployment/bootstrap').
            ' && sh install-v2box.sh --migrate-api --from-api-host '.$q($from).' --api-host '.$q($to).($serverOnly?' --server-id ':' --node-id ').$id.' --migration-token '.$q($token),
            'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',$expires),'fromApiHost'=>$from,'toApiHost'=>$to,
            'rollbackCommand'=>'python3 /usr/local/lib/v2box/api-migrate.py --rollback'];
    }
    public static function progress(string $token,array $body): array {
        abort_unless(preg_match('/^am_[a-f0-9]{64}$/D',$token),401);
        $key='api-migration:'.hash('sha256',$token);
        return self::cache()->lock($key.':lock',15)->block(3,function()use($key,$body){
            $g=self::cache()->get($key);abort_unless(is_array($g) && $g['expires']>time(),401,'迁移授权已过期');
            $actor=User::find($g['actor']);
            abort_unless($actor && $actor->is_admin && !$actor->banned && !$actor->account_deleted_at && hash_equals($g['actorProof'],hash('sha256',(string)$actor->password)),403);
            abort_unless(self::origin(NodeDeployment::host())===$g['to'],409,'节点 API 地址已改变，请重新生成迁移命令');
            $ids=$body['nodeIds'];sort($ids,SORT_NUMERIC);
            if($g['serverId']) {
                abort_unless($ids===[],403);
                $server=DB::table('v2_network_server')->find($g['serverId']);
                abort_unless($server && hash_equals($g['serverProof'],hash('sha256',json_encode([$server->report_hash,$server->family,$server->enabled]))),409,'服务器上报配置已改变');
            } else abort_unless(in_array($g['nodeId'],$ids,true),403);
            foreach($ids as $id) abort_unless(isset($g['proofs'][$id]) && hash_equals($g['proofs'][$id],self::proof($id)),409,'节点配置或密钥策略已变更，请重新生成迁移命令');
            $base=['fromApiHost'=>$g['from'],'toApiHost'=>$g['to'],'nodeIds'=>$ids];
            if($g['serverId']) $base['serverId']=$g['serverId'];
            if($body['action']==='probe') return $base+['proof'=>hash_hmac('sha256',json_encode([$key,$base,$body['challenge']]),(string)config('app.key'))];
            if($body['action']==='start') {
                $g['startedAt']=microtime(true);$g['nodeIds']=$ids;
                self::cache()->put($key,$g,max(1,$g['expires']-time()));
                return $base+['ready'=>false,'failed'=>false];
            }
            abort_unless(isset($g['startedAt']) && $ids===$g['nodeIds'],409,'请先启动该迁移任务');
            $ready=true;$failed=false;
            foreach($ids as $id) {
                $r=self::cache()->get(self::receiptKey($g['to'],$id));
                $fresh=$r && $r['at']>=$g['startedAt'];
                $ready=$ready && $fresh && $r['state']==='applied';
                $failed=$failed || ($fresh && $r['state']==='failed');
            }
            return $base+['ready'=>$ready,'failed'=>$failed];
        });
    }
    private static function receiptKey(string $host,int $id): string { return 'api-origin-receipt:'.hash('sha256',$host).':'.$id; }
    public static function record(Request $request,int $id,array $configuration): void {
        // Host identifies the actual HTTP destination; old-domain receipts cannot confirm a migration.
        $host=self::origin('https://'.$request->getHttpHost());
        $last=Cache::get('NODE_CONFIG_FETCH:v2box:'.$id);
        if(!$last || !hash_equals($last['hash'],$configuration['hash'])) return;
        self::cache()->put(self::receiptKey($host,$id),['state'=>$configuration['state'],'at'=>microtime(true)],3600);
    }
}
