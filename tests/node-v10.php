<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Cache;
use App\Models\ServerV2box;
use App\Http\Controllers\V1\Admin\Server\V2boxController;

$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
config(['v2board.server_token'=>'node-v10-test-secret', 'cache.default'=>'array']);
Queue::fake();
$kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
$nodeId=0;
$call=function($method,$path,$body=[],$headers=[])use($kernel,&$nodeId){
    $server=array_merge(['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer node-v10-test-secret','HTTP_X_NODE_TYPE'=>'v2box','HTTP_X_NODE_ID'=>(string)$nodeId,'HTTP_X_NODE_CAPABILITIES'=>'native-routing-v1,dns-v1,outbounds-v1'], $headers);
    $request=Request::create($path,$method,[],[],[],$server,json_encode($body));
    return $kernel->handle($request);
};
DB::beginTransaction();
try {
    $base=['group_id'=>[999997],'name'=>'V10 node test','host'=>'example.test','port'=>'443','server_port'=>443,'listen_ip'=>'0.0.0.0','protocol'=>'vless','tls'=>0,'network'=>'tcp','network_settings'=>[],'encryption_settings'=>[],'disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','show'=>1];
    $native=['dns'=>['servers'=>[['type'=>'https','tag'=>'resolver','server'=>'1.1.1.1']],'final'=>'resolver'],'route'=>['rule_set'=>[['type'=>'inline','tag'=>'private','rules'=>[['ip_cidr'=>['127.0.0.0/8']]]]],'rules'=>[['rule_set'=>['private'],'action'=>'reject']],'final'=>'direct']];
    $profile=App\Models\ServerRoute::create(['backend'=>'v2box','remarks'=>'V10 native test','match'=>'[]','action'=>'sing_box','sing_box'=>$native]);
    $admin=new V2boxController();$admin->save(Request::create('/','POST',$base+['route_id'=>[$profile->id]]));
    $node=ServerV2box::where('name',$base['name'])->firstOrFail();
    $assert(App\Services\NodeRouteService::forNode($node)===$native,'Native config persisted');
    $nodeId=$node->id;
    $root='/api/v10/server';
    $r=$call('POST',$root.'/capabilities',['coreVersion'=>'v1.14.3','features'=>['native-routing-v1']]);
    $assert($r->getStatusCode()===200,'Capabilities accepted: '.$r->getStatusCode().' '.$r->getContent());
    $assert(Cache::get('V2BOX_CAPABILITIES:'.$node->id)['coreVersion']==='v1.14.3','Capability cache');
    $r=$call('GET',$root.'/configuration');$body=json_decode($r->getContent(),true);
    $assert($r->getStatusCode()===200 && $body['data']['listenPort']===443 && $body['data']['singBox']===$native,'V10 config projection: '.$r->getStatusCode().' '.$r->getContent());
    $assert(!isset($body['data']['server_port']),'No legacy field naming');
    $assert(is_object(json_decode($r->getContent())->data->tlsSettings),'Empty TLS settings encoded as object');
    $assert(is_object(json_decode($r->getContent())->data->networkSettings) && is_object(json_decode($r->getContent())->data->encryptionSettings),'Empty protocol settings encoded as objects');
    $assert($call('GET',$root.'/configuration',[],['HTTP_IF_NONE_MATCH'=>$r->headers->get('ETag')])->getStatusCode()===304,'Config ETag');
    $assert($call('GET',$root.'/configuration',[],['HTTP_X_NODE_CAPABILITIES'=>''])->getStatusCode()===409,'Capability guard');
    $tag=$r->headers->get('ETag');
    $updated=$native;$updated['route']['rules'][]=['domain_suffix'=>['updated.test'],'action'=>'reject'];
    $profile->update(['sing_box'=>$updated]);
    $changed=$call('GET',$root.'/configuration',[],['HTTP_IF_NONE_MATCH'=>$tag]);
    $assert($changed->getStatusCode()===200 && $changed->headers->get('ETag')!==$tag,'Catalog rule edit changes configuration ETag');
    $profile->update(['sing_box'=>$native]);
    $r=$call('GET',$root.'/users');$assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']===[],'Empty user table: '.$r->getStatusCode().' '.$r->getContent());
    $assert($call('GET',$root.'/users',[],['HTTP_IF_NONE_MATCH'=>$r->headers->get('ETag')])->getStatusCode()===304,'User ETag');
    foreach (['','Bearer wrong'] as $auth) {
        $r=$call('GET',$root.'/users?token=node-v10-test-secret',[],['HTTP_AUTHORIZATION'=>$auth]);
        $assert($r->getStatusCode()===401,'Query token and bad auth rejected');
        $body=json_decode($r->getContent(),true);$assert($body['requestId']===$r->headers->get('X-Request-ID'),'Problem request ID');
        $assert(!isset($body['exception'],$body['trace']),'No exception details');
    }
    $assert($call('GET',$root.'/configuration',[],['HTTP_X_NODE_ID'=>'999999999'])->getStatusCode()===404,'Unknown node');
    foreach (['', '0', '-1', '1.5', '999999999999999999999999'] as $id) $assert($call('GET',$root.'/users',[],['HTTP_X_NODE_ID'=>$id])->getStatusCode()===422,'Invalid/missing node ID rejected');
    foreach (['', 'v2node', 'unknown'] as $type) $assert($call('GET',$root.'/users',[],['HTTP_X_NODE_TYPE'=>$type])->getStatusCode()===422,'Unsupported/missing node type rejected');
    $assert($call('GET',$root.'/users?node_id='.$nodeId.'&node_type=v2box',[],['HTTP_X_NODE_ID'=>''])->getStatusCode()===422,'Query identity cannot replace headers');
    $assert($call('GET','/api/v10/nodes/v2box/'.$nodeId.'/users')->getStatusCode()===404,'Product-specific path retired');
    $traffic=['records'=>[['userId'=>42,'uploadBytes'=>1024,'downloadBytes'=>2048]]];
    $assert($call('POST',$root.'/traffic',$traffic)->getStatusCode()===202,'Traffic queued');
    $assert(Queue::pushed(App\Jobs\TrafficFetchJob::class)->count()===1,'Exactly one accounting job');
    $assert($call('POST',$root.'/traffic',['records'=>[['userId'=>42,'uploadBytes'=>-1,'downloadBytes'=>0]]])->getStatusCode()===422,'Negative traffic rejected');
    $assert($call('POST',$root.'/traffic',['records'=>array_merge($traffic['records'],$traffic['records'])])->getStatusCode()===422,'Duplicate user record rejected');
    $assert($call('POST',$root.'/online-users',['records'=>[]])->getStatusCode()===200,'Empty online update');
    $assert($call('POST',$root.'/online-users',['records'=>[['userId'=>42,'ips'=>['bad']]]])->getStatusCode()===422,'Invalid address rejected');
    $assert($call('GET',$root.'/online-counts')->getStatusCode()===200,'Online counts');
    foreach ([['inbounds'=>[]],['dns'=>['servers'=>[['type'=>'fakeip']]]],['outbounds'=>[['type'=>'direct','tag'=>'direct']]],['route'=>['rule_set'=>[['type'=>'local','path'=>'/etc/passwd']]]]] as $bad) {
        try {$admin->save(Request::create('/','POST',$base+['id'=>$node->id,'sing_box'=>$bad]));throw new RuntimeException('Bad native config accepted');}
        catch(Illuminate\Validation\ValidationException $e){$checks++;}
    }
    $request=Request::create('/','GET',['token'=>'node-v10-test-secret','node_type'=>'v2box','node_id'=>$node->id]);
    $legacy=(new App\Http\Controllers\V2\Server\ServerController($request))->config($request);
    $assert(json_decode($legacy->getContent(),true)['protocol']==='vless','Legacy configuration still works');
    $legacyUsers=(new App\Http\Controllers\V1\Server\UniProxyController($request))->user($request);
    $assert(isset(json_decode($legacyUsers->getContent(),true)['users']),'Legacy users still work');
    $route = App\Models\ServerRoute::create(['backend'=>'v2box','remarks'=>'V10 test','match'=>json_encode(['domain:example.test']),'action'=>'block']);
    if ($fixture=getenv('NODE_V10_FIXTURE')) file_put_contents($fixture,$call('GET',$root.'/configuration')->getContent());
    $node->route_id=[$route->id];$node->save();
    $r=$call('GET',$root.'/configuration');
    $assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']['routes'][0]['action']==='block','Legacy routes projected into V10');
    $user=new App\Models\User(['email'=>'node-v10-test@example.test','password'=>'unused','uuid'=>'b831381d-6324-4d53-ad4f-8cda48b30811','token'=>'node-v10-test','group_id'=>999997,'expired_at'=>null,'transfer_enable'=>1024,'u'=>0,'d'=>0,'banned'=>0]);$user->save();
    $r=$call('GET',$root.'/users');$list=json_decode($r->getContent(),true)['data'];
    $assert(count($list)===1 && $list[0]['uuid']===$user->uuid && array_key_exists('speedLimit',$list[0]),'User resource projection');
    $public=(new App\Services\ServerService())->getAvailableV2node($user,'v2box');
    foreach($public as $item) $assert(!array_key_exists('sing_box',$item),'Server credentials hidden from subscribers');
    $stats=app(App\Services\TargetStatistics::class);
    $assert($stats->policy()['enabled']===false,'Target statistics defaults off');
    $assert($call('GET',$root.'/target-statistics/policy',[],['HTTP_AUTHORIZATION'=>'Bearer wrong'])->getStatusCode()===401,'Target policy requires node authentication');
    $assert(json_decode($call('POST',$root.'/target-statistics',['records'=>[]])->getContent(),true)['data']['accepted']===false,'Disabled receiver rejects collection');
    $policy=$stats->configure(true);
    $batch=['version'=>$policy['version'],'batchId'=>(string)Illuminate\Support\Str::uuid(),'dropped'=>0,'records'=>[
        ['userId'=>$user->id,'target'=>'Example.COM.','type'=>'domain','connections'=>1,'uploadBytes'=>100,'downloadBytes'=>200],
        ['userId'=>$user->id,'target'=>'2001:0db8::1','type'=>'ip','connections'=>1,'uploadBytes'=>20,'downloadBytes'=>30],
    ]];
    $response=$call('POST',$root.'/target-statistics',$batch);
    $assert($response->getStatusCode()===200,'Target batch accepted: '.$response->getContent());
    $assert($call('POST',$root.'/target-statistics',$batch)->getStatusCode()===200,'Retry accepted');
    $report=$stats->report($nodeId,(int)$user->id,1);
    $assert($report['total']===2 && $report['rows'][0]['uploadBytes']===100,'Retry counted only once');
    $assert($report['rows'][0]['target']==='example.com' && $report['rows'][1]['target']==='2001:db8::1','Domain and IP normalized');
    $assert($stats->report($nodeId,2147483646,1)['total']===0,'User filter isolated');
    $changed=$batch;$changed['records'][0]['uploadBytes']=999;
    $assert($call('POST',$root.'/target-statistics',$changed)->getStatusCode()===409,'Mutated retry rejected');
    $bad=$batch;$bad['batchId']=(string)Illuminate\Support\Str::uuid();$bad['records'][0]['target']='https://example.com/private?token=secret';
    $assert($call('POST',$root.'/target-statistics',$bad)->getStatusCode()===422,'Full URLs rejected');
    $assert($stats->report($nodeId,0,1)['total']===2,'Invalid batch not partially written');
    $bad=$batch;$bad['batchId']=(string)Illuminate\Support\Str::uuid();$bad['records'][0]['uploadBytes']=-1;
    $assert($call('POST',$root.'/target-statistics',$bad)->getStatusCode()===422,'Negative target traffic rejected');
    $stats->configure(false);
    $assert($stats->report($nodeId,0,1)['total']===0,'Disabled report hides previous generation');
    $assert(json_decode($call('POST',$root.'/target-statistics',$batch)->getContent(),true)['data']['accepted']===false,'Disabled rejects in-flight batch');
    $newPolicy=$stats->configure(true);
    $assert($newPolicy['version']!==$policy['version'],'Reenable gets fresh generation');
    $assert(json_decode($call('POST',$root.'/target-statistics',$batch)->getContent(),true)['data']['accepted']===false,'Old generation rejected after reenable');
    $adminPath='/api/v1/'.config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
    $adminCall=function($token,$enabled)use($kernel,$adminPath){$request=Request::create($adminPath.'/target-statistics/settings','POST',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>$token],json_encode(['enabled'=>$enabled]));return $kernel->handle($request);};
    $assert($adminCall('',false)->getStatusCode()===403,'Anonymous cannot change target switch');
    $auth=new App\Services\AuthService($user);$token=$auth->generateAuthData(Request::create('/'))['auth_data'];
    $assert($adminCall($token,false)->getStatusCode()===403,'Ordinary user cannot change target switch');
    $user->is_admin=1;$user->save();
    $adminResponse=$adminCall($token,false);
    $assert($adminResponse->getStatusCode()===200,'Administrator disables statistics: '.$adminResponse->getStatusCode().' '.$adminResponse->getContent());
    $assert($stats->policy()['enabled']===false,'Admin switch persisted');
    $credentials=App\Services\NodeCredentials::class;
    $assert(!$credentials::listing('v2box',$nodeId)['migrated'],'Existing node remains compatible before migration');
    $key=$credentials::issue('v2box',$nodeId,(int)$user->id);
    $assert(preg_match('/^nk_[a-f0-9]{32}\.[a-f0-9]{64}$/',$key['secret'])===1,'Random credential format');
    $stored=DB::table('v2_node_credential')->where('id',$key['id'])->first();
    $assert(!str_contains(json_encode($stored),substr($key['secret'],36)),'Database stores only hash');
    $assert(!str_contains(json_encode($credentials::listing('v2box',$nodeId)),$stored->secret_hash),'Listing hides credential hash');
    $assert($call('GET',$root.'/users')->getStatusCode()===401,'Migrated node cannot fall back to global token');
    $headers=['HTTP_AUTHORIZATION'=>'Bearer '.$key['secret']];
    $assert($call('GET',$root.'/users',[],$headers)->getStatusCode()===200,'Independent key accepted');
    $assert($call('GET',$root.'/users',[],array_merge($headers,['HTTP_X_NODE_ID'=>(string)($nodeId+1)]))->getStatusCode()===403,'Key cannot access another node');
    $assert($call('GET',$root.'/users',[],array_merge($headers,['HTTP_X_NODE_TYPE'=>'v2node']))->getStatusCode()===403,'Key cannot access another backend');
    $legacySecure=Request::create('/','GET',['node_type'=>'v2box','node_id'=>$nodeId],[],[],['HTTP_AUTHORIZATION'=>'Bearer '.$key['secret']]);
    $assert((new App\Http\Controllers\V1\Server\UniProxyController())->user($legacySecure)->getStatusCode()===200,'Legacy endpoint supports scoped bearer');
    foreach([App\Http\Controllers\V1\Server\UniProxyController::class=>'user',App\Http\Controllers\V2\Server\ServerController::class=>'config'] as $controller=>$method) {
        $invalid=Request::create('/','GET',['node_type'=>'v2box','node_id'=>[$nodeId]],[],[],['HTTP_AUTHORIZATION'=>'Bearer '.$key['secret']]);
        try {(new $controller())->$method($invalid);$assert(false,'Array node identity rejected');}
        catch(Illuminate\Validation\ValidationException $e){$assert(true,'Array node identity rejected');}
    }
    try { $credentials::authenticate($key['secret'],'v2box',$nodeId,false); $assert(false,'Query credential rejected'); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===401,'Query credential rejected');}
    $next=$credentials::issue('v2box',$nodeId,(int)$user->id);
    $assert($call('GET',$root.'/users',[],$headers)->getStatusCode()===200,'Old key works during manual grace period');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$next['secret']])->getStatusCode()===200,'New key works during grace period');
    try { $credentials::issue('v2box',$nodeId,(int)$user->id); $assert(false,'Concurrent rotation blocked'); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Concurrent rotation blocked');}
    DB::table('v2_node_credential')->where('id',$key['id'])->update(['expires_at'=>time()-1]);
    $assert($call('GET',$root.'/users',[],$headers)->getStatusCode()===401,'Expired grace rejected');
    $credentials::revoke('v2box',$nodeId,$next['id'],(int)$user->id);
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$next['secret']])->getStatusCode()===401,'Revocation effective on next request');
    $assert($call('GET',$root.'/users')->getStatusCode()===401,'Revoking all keys cannot restore global authentication');
    $user->password=password_hash('test-admin-credential-password',PASSWORD_DEFAULT);$user->save();
    $credentialCall=function($action,$body,$authorization=null)use($kernel,$adminPath,$token) {
        return $kernel->handle(Request::create($adminPath.'/server/credentials/'.$action,'POST',[],[],[],
            ['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>$authorization??$token],json_encode($body)));
    };
    $params=['type'=>'v2box','id'=>$nodeId,'password'=>'wrong'];
    $assert($credentialCall('issue',$params)->getStatusCode()===403,'Sensitive operation verifies password');
    $params['password']='test-admin-credential-password';
    $assert($credentialCall('issue',$params,'')->getStatusCode()===403,'Anonymous cannot generate credentials');
    $user->is_admin=0;$user->save();
    $assert($credentialCall('issue',$params)->getStatusCode()===403,'Ordinary user cannot generate credentials');
    $user->is_admin=1;$user->save();
    $issued=$credentialCall('issue',$params);
    $assert($issued->getStatusCode()===201,'Administrator generates credential');
    $assert(str_contains($issued->headers->get('Cache-Control'),'no-store'),'One-time credential response not cached');
    $publicKeys=$kernel->handle(Request::create($adminPath.'/server/credentials?type=v2box&id='.$nodeId,'GET',[],[],[],['HTTP_AUTHORIZATION'=>$token,'HTTP_ACCEPT'=>'application/json']));
    $assert($publicKeys->getStatusCode()===200 && !str_contains($publicKeys->getContent(),'nk_'),'Later listing never reveals secret');
    try {$credentials::disableLegacy((int)$user->id);$assert(false,'Unconfirmed migration cannot disable legacy');}
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Unconfirmed migration cannot disable legacy');}
    $install=(new App\Services\ServerService())->getAllServers();
    $assert(!str_contains(json_encode($install),'node-v10-test-secret'),'Install commands never expose global token');
    $freshSecret=json_decode($issued->getContent(),true)['data']['secret'];
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$freshSecret])->getStatusCode()===200,'Replacement confirmed before global retirement');
    $assert(count($credentials::legacyNodes())===0,'Migration report excludes migrated node');
    $credentials::disableLegacy((int)$user->id);
    $assert(!$credentials::legacyEnabled(),'All confirmed nodes allow global retirement');
    $assert($call('GET',$root.'/users',[],['HTTP_X_NODE_ID'=>'999999999'])->getStatusCode()===401,'Retired global key cannot access new identities');
    $auth->removeAllSession();
    echo "PASS: $checks V10 node checks\n";
} finally { DB::rollBack(); }
