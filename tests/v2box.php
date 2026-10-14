<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use App\Models\ServerV2box;
use App\Models\ServerV2node;
use App\Services\ServerService;
use App\Utils\CacheKey;
config(['v2board.server_token'=>'v2box-local-test']);
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
$cacheKeys=[];
try {
    $id=max((int) ServerV2node::max('id'), (int) ServerV2box::max('id'))+100;
    $base=['group_id'=>[999999], 'name'=>'V2Box test', 'host'=>'example.test', 'port'=>'443', 'server_port'=>443, 'listen_ip'=>'0.0.0.0', 'protocol'=>'vless', 'tls'=>0, 'network'=>'tcp', 'disable_sni'=>0, 'zero_rtt_handshake'=>0, 'rate'=>'1', 'show'=>1, 'up_mbps'=>0, 'down_mbps'=>0, 'tls_settings'=>['private_key'=>'secret','ech_key'=>'secret','tls_key'=>'secret']];
    foreach ([ServerV2node::class, ServerV2box::class] as $class) {
        $node=new $class($base); $node->id=$id; $node->save();
    }
    $svc=new ServerService();
    $assert($svc->getServer($id,'v2box') instanceof ServerV2box, 'V2Box lookup');
    $assert(get_class($svc->getServer($id,'v2node'))===ServerV2node::class, 'V2Node lookup isolated');
    $user=new App\Models\User(['group_id'=>999999]);
    foreach (['v2node','v2box'] as $type) {
        $nodes=$svc->getAvailableV2node($user,$type);
        $node=array_values(array_filter($nodes,fn($n)=>$n['id']==$id))[0];
        $assert($node['type']===$type, 'Subscription type preserved');
        $assert(!isset($node['tls_settings']['private_key'],$node['tls_settings']['ech_key'],$node['tls_settings']['tls_key']), 'Secrets stripped');
        $assert(strpos(App\Utils\Helper::buildUri('00000000-0000-4000-8000-000000000001',$node),'vless://')===0,'Subscription URI');
        $request=Request::create('/api/v2/server/config','GET',['token'=>config('v2board.server_token'),'node_type'=>$type,'node_id'=>$id]);
        $controller=new App\Http\Controllers\V2\Server\ServerController($request);
        $config=json_decode($controller->config($request)->getContent(),true);
        $assert($config['protocol']==='vless','Node config');
        $request=Request::create('/api/v1/server/UniProxy/user','GET',['token'=>config('v2board.server_token'),'node_type'=>$type,'node_id'=>$id]);
        $controller=new App\Http\Controllers\V1\Server\UniProxyController($request);
        $controller->user($request);
        $key=CacheKey::get('SERVER_'.strtoupper($type).'_LAST_CHECK_AT',$id); $cacheKeys[]=$key;
        $assert(Cache::has($key),'Independent heartbeat');
    }
    $legacy=Request::create('/api/v2/server/config','GET',['token'=>config('v2board.server_token'),'node_id'=>$id]);
    $assert(json_decode((new App\Http\Controllers\V2\Server\ServerController($legacy))->config($legacy)->getContent(),true)['protocol']==='vless','Legacy config without node_type');
    Illuminate\Support\Facades\Queue::fake();
    $push=Request::create('/api/v1/server/UniProxy/push?'.http_build_query(['token'=>config('v2board.server_token'),'node_type'=>'v2box','node_id'=>$id]),'POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode([123=>[1024,2048]]));
    (new App\Http\Controllers\V1\Server\UniProxyController($push))->push($push);
    $assert(Illuminate\Support\Facades\Queue::pushed(App\Jobs\TrafficFetchJob::class)->count()===1, 'Traffic job queued');
    foreach (['ONLINE_USER','LAST_PUSH_AT'] as $suffix) $cacheKeys[]=CacheKey::get('SERVER_V2BOX_'.$suffix,$id);
    $assert((int) Cache::get(CacheKey::get('SERVER_V2BOX_ONLINE_USER',$id))===1,'Traffic report updates V2Box status');
    $assert(!Cache::has(CacheKey::get('SERVER_V2NODE_ONLINE_USER',$id)),'Traffic report leaves V2Node status unchanged');
    $all=$svc->getAllServers();
    $nodes=array_values(array_filter($all,fn($n)=>$n['id']==$id && in_array($n['type'],['v2node','v2box'])));
    $assert(count($nodes)===2,'Both types listed with same id');
    foreach ($nodes as $node) if ($node['type']==='v2box') $assert(strpos($node['install_command'],'--node-type v2box')!==false,'Installer selects V2Box');
    $admin=new App\Http\Controllers\V1\Admin\Server\V2boxController();
    foreach ([['network'=>'xhttp'], ['network'=>'http'], ['encryption'=>'mlkem768x25519plus'], ['trusted_x_forwarded_for'=>['127.0.0.1']], ['tls_settings'=>['ech'=>'custom']]] as $invalid) {
        try { $admin->save(Request::create('/','POST',array_merge($base,$invalid))); throw new RuntimeException('Invalid config accepted'); }
        catch (Illuminate\Validation\ValidationException $e) { $checks++; }
    }
    $admin->save(Request::create('/','POST',array_merge($base,['id'=>$id,'name'=>'V2Box updated','tls_settings'=>null])));
    $assert(ServerV2box::find($id)->name==='V2Box updated','V2Box update');
    $assert(ServerV2node::find($id)->name==='V2Box test','V2Node untouched');
    $admin->copy(Request::create('/','POST',['id'=>$id]));
    $assert(ServerV2box::where('name','V2Box updated')->count()===2,'V2Box copy');
    $admin->drop(Request::create('/','POST',['id'=>$id]));
    $assert(!ServerV2box::find($id) && ServerV2node::find($id),'V2Box delete isolated');
    $schema=json_decode((new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>'v2box']))->getContent(),true)['data'];
    $assert(isset($schema['protocol'],$schema['region_code']) && $schema['network']==='required|in:tcp,ws,grpc,httpupgrade','Admin schema');
    echo "PASS: $checks V2Box integration checks\n";
} finally {
    DB::rollBack();
    foreach ($cacheKeys as $key) Cache::forget($key);
}
