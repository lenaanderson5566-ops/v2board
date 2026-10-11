<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function($e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); });
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Services\ServerService;
$checks=0;
$assert=function($ok,$label)use(&$checks){if(!$ok)throw new RuntimeException($label);$checks++;};
$reject=function($fn)use($assert){try{$fn();throw new RuntimeException('Retired type accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===422,'Retired type rejected');}};
$legacy=['vmess','vless','shadowsocks','trojan','hysteria','tuic','anytls','v2ray','hysteria2'];
config(['v2board.server_token'=>'local-node-retirement-test']);
$svc=new ServerService();
foreach($legacy as $type){
    $assert($svc->getServer(1,$type)===null,'Legacy lookup removed '.$type);
    $reject(fn()=>(new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>$type])));
    $reject(fn()=>new App\Http\Controllers\V1\Server\UniProxyController(Request::create('/','GET',['token'=>config('v2board.server_token'),'node_type'=>$type,'node_id'=>1])));
    $reject(fn()=>(new App\Http\Controllers\V1\Admin\Server\ManageController())->sort(Request::create('/','POST',[$type=>[1=>1]])));
}
$routes=app('router')->getRoutes();
foreach($routes as $route){
    $assert(!preg_match('#/server/(vmess|vless|shadowsocks|trojan|hysteria|tuic|anytls)/#',$route->uri()),'Retired admin routes absent');
    $assert(!str_contains($route->uri(),'server/{class}'),'Dynamic node dispatch absent');
}
foreach(['GET'=>['/api/v1/server/UniProxy/user','/api/v1/server/UniProxy/alivelist','/api/v2/server/config'], 'POST'=>['/api/v1/server/UniProxy/push','/api/v1/server/UniProxy/alive']] as $method=>$paths){
    foreach($paths as $path){$route=$routes->match(Request::create($path,$method));$assert($route->getActionName()!=='Closure','Explicit node handler '.$path);}
}
foreach(['/api/v1/server/Deepbwork/user','/api/v1/server/TrojanTidalab/user','/api/v1/server/ShadowsocksTidalab/user','/api/v1/server/UniProxy/config'] as $path){
    try{$route=$routes->match(Request::create($path,'GET'));$assert(!str_starts_with($route->uri(),'api/'),'Retired route cannot reach API');}
    catch(Symfony\Component\HttpKernel\Exception\NotFoundHttpException $e){$checks++;}
}
DB::beginTransaction();
try{
    $group=new App\Models\ServerGroup(); $group->name='Node retirement fixture'; $group->save();
    $old=App\Models\ServerShadowsocks::create(['group_id'=>[$group->id],'name'=>'Retired test','host'=>'example.test','port'=>'443','server_port'=>443,'cipher'=>'aes-128-gcm','rate'=>'1','show'=>1]);
    $base=['group_id'=>[$group->id],'name'=>'Active test','host'=>'example.test','port'=>'443','server_port'=>443,'listen_ip'=>'0.0.0.0','protocol'=>'vless','network'=>'tcp','tls'=>0,'disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','show'=>1,'up_mbps'=>0,'down_mbps'=>0];
    $node=App\Models\ServerV2node::create($base);
    $box=App\Models\ServerV2box::create($base);
    $user=new App\Models\User(['group_id'=>$group->id]);
    $available=$svc->getAvailableServers($user);
    $assert(count($available)===2,'Subscriptions contain only two current backends');
    $assert(!array_diff(array_column($svc->getAllServers(),'type'),['v2node','v2box']),'Admin listing excludes legacy');
    $assert(App\Models\ServerShadowsocks::find($old->id)!==null,'Historical record retained');
    $manage=new App\Http\Controllers\V1\Admin\Server\ManageController();
    $manage->sort(Request::create('/','POST',['v2node'=>[$node->id=>2],'v2box'=>[$box->id=>1]]));
    $assert((int)$node->fresh()->sort===2 && (int)$box->fresh()->sort===1,'Sorting both types works');
    try{(new App\Http\Controllers\V1\Admin\Server\GroupController())->drop(Request::create('/','POST',['id'=>$group->id]));throw new RuntimeException('In-use group deleted');}
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getMessage()==='该组已被节点所使用，无法删除','Active backend group protected');}
    foreach(['shadowsocks','v2node','v2box'] as $type) App\Models\StatServer::create(['server_id'=>($type==='v2box'?$box->id:$node->id),'server_type'=>$type,'u'=>1024,'d'=>2048,'record_type'=>'d','record_at'=>strtotime(date('Y-m-d'))]);
    $rank=(new App\Http\Controllers\V1\Admin\StatController())->getServerTodayRank()['data'];
    $assert(!array_diff(array_column($rank,'server_type'),['v2node','v2box']),'Ranking excludes retired types');
}finally{DB::rollBack();}
echo "Node backend retirement: $checks checks passed\n";
