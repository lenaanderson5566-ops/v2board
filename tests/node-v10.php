<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Cache;
use App\Models\ServerV2box;
use App\Http\Controllers\V1\Admin\Server\V2boxController;

$checks=0;
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
$assert=function($ok,$label)use(&$checks){if(!$ok)throw new RuntimeException($label);$checks++;};
config(['v2board.server_token'=>'node-v10-test-secret', 'cache.default'=>'array']);
Queue::fake();
$kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
$call=function($method,$path,$body=[],$headers=[])use($kernel){
    $server=array_merge(['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer node-v10-test-secret','HTTP_X_V2BOX_CAPABILITIES'=>'native-routing-v1,dns-v1,outbounds-v1'], $headers);
    $request=Request::create($path,$method,[],[],[],$server,json_encode($body));
    return $kernel->handle($request);
};
DB::beginTransaction();
try {
    $base=['group_id'=>[999997],'name'=>'V10 node test','host'=>'example.test','port'=>'443','server_port'=>443,'listen_ip'=>'0.0.0.0','protocol'=>'vless','tls'=>0,'network'=>'tcp','network_settings'=>[],'encryption_settings'=>[],'disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','show'=>1];
    $native=['dns'=>['servers'=>[['type'=>'https','tag'=>'resolver','server'=>'1.1.1.1']],'final'=>'resolver'],'route'=>['rule_set'=>[['type'=>'inline','tag'=>'private','rules'=>[['ip_cidr'=>['127.0.0.0/8']]]]],'rules'=>[['rule_set'=>['private'],'action'=>'reject']],'final'=>'direct']];
    $admin=new V2boxController();$admin->save(Request::create('/','POST',$base+['sing_box'=>$native]));
    $node=ServerV2box::where('name',$base['name'])->firstOrFail();
    $assert($node->sing_box===$native,'Native config persisted');
    $root='/api/v10/nodes/v2box/'.$node->id;
    $r=$call('POST',$root.'/capabilities',['coreVersion'=>'v1.14.3','features'=>['native-routing-v1']]);
    $assert($r->getStatusCode()===200,'Capabilities accepted');
    $assert(Cache::get('V2BOX_CAPABILITIES:'.$node->id)['coreVersion']==='v1.14.3','Capability cache');
    $r=$call('GET',$root.'/configuration');$body=json_decode($r->getContent(),true);
    $assert($r->getStatusCode()===200 && $body['data']['listenPort']===443 && $body['data']['singBox']===$native,'V10 config projection');
    $assert(!isset($body['data']['server_port']),'No legacy field naming');
    $assert(is_object(json_decode($r->getContent())->data->tlsSettings),'Empty TLS settings encoded as object');
    $assert(is_object(json_decode($r->getContent())->data->networkSettings) && is_object(json_decode($r->getContent())->data->encryptionSettings),'Empty protocol settings encoded as objects');
    $assert($call('GET',$root.'/configuration',[],['HTTP_IF_NONE_MATCH'=>$r->headers->get('ETag')])->getStatusCode()===304,'Config ETag');
    $assert($call('GET',$root.'/configuration',[],['HTTP_X_V2BOX_CAPABILITIES'=>''])->getStatusCode()===409,'Capability guard');
    $r=$call('GET',$root.'/users');$assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']===[],'Empty user table');
    $assert($call('GET',$root.'/users',[],['HTTP_IF_NONE_MATCH'=>$r->headers->get('ETag')])->getStatusCode()===304,'User ETag');
    foreach (['','Bearer wrong'] as $auth) {
        $r=$call('GET',$root.'/users?token=node-v10-test-secret',[],['HTTP_AUTHORIZATION'=>$auth]);
        $assert($r->getStatusCode()===401,'Query token and bad auth rejected');
        $body=json_decode($r->getContent(),true);$assert($body['requestId']===$r->headers->get('X-Request-ID'),'Problem request ID');
        $assert(!isset($body['exception'],$body['trace']),'No exception details');
    }
    $assert($call('GET','/api/v10/nodes/v2box/999999999/configuration')->getStatusCode()===404,'Unknown node');
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
    $route = App\Models\ServerRoute::create(['remarks'=>'V10 test','match'=>json_encode(['domain:example.test']),'action'=>'block']);
    $node->route_id=[$route->id];$node->save();
    $r=$call('GET',$root.'/configuration');
    $assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']['routes'][0]['action']==='block','Legacy routes projected into V10');
    if ($fixture=getenv('NODE_V10_FIXTURE')) file_put_contents($fixture,$r->getContent());
    $user=new App\Models\User(['email'=>'node-v10-test@example.test','password'=>'unused','uuid'=>'b831381d-6324-4d53-ad4f-8cda48b30811','token'=>'node-v10-test','group_id'=>999997,'expired_at'=>null,'transfer_enable'=>1024,'u'=>0,'d'=>0,'banned'=>0]);$user->save();
    $r=$call('GET',$root.'/users');$list=json_decode($r->getContent(),true)['data'];
    $assert(count($list)===1 && $list[0]['uuid']===$user->uuid && array_key_exists('speedLimit',$list[0]),'User resource projection');
    $public=(new App\Services\ServerService())->getAvailableV2node($user,'v2box');
    foreach($public as $item) $assert(!array_key_exists('sing_box',$item),'Server credentials hidden from subscribers');
    echo "PASS: $checks V10 node checks\n";
} finally { DB::rollBack(); }
