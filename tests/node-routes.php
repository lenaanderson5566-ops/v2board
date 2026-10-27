<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\ServerRoute;
use App\Models\ServerV2box;
use App\Services\NodeRouteService;
use App\Http\Controllers\V1\Admin\Server\RouteController;
use App\Http\Controllers\V1\Admin\Server\V2boxController;
set_exception_handler(function($e) { fwrite(STDERR, $e->getMessage()."\n".$e->getTraceAsString()."\n"); exit(1); });
$checks=0;
config(['v2board.server_token'=>'routing-test-secret', 'cache.default'=>'array']);
$assert = \Tests\Support\Assertions::counter($checks);
$reject=function($fn,$label) use ($assert) {
    try { $fn(); } catch (Illuminate\Validation\ValidationException $e) { $assert(true,$label); return; }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422,$label); return; }
    throw new RuntimeException($label);
};
$request=fn($body)=>Request::create('/','POST',$body);
DB::beginTransaction();
try {
    $admin=new RouteController();
    $reject(fn()=>$admin->save($request(['remarks'=>'retired creation','action'=>'block','match'=>['example.com']])),'New rules require native sing-box configuration');
    foreach (json_decode(file_get_contents(resource_path('client/node-route-presets.json')),true) as $preset) {
        App\Services\V2boxFeatures::validate($preset['config'],true);
        $assert(true,'Native preset valid: '.$preset['id']);
    }
    foreach ([['dns'=>'bad'],['route'=>false],['route'=>['rules'=>[['action'=>'block']]]],['route'=>['rules'=>[['geosite'=>['cn'],'action'=>'reject']]]],['route'=>['rules'=>[['type'=>'logical','mode'=>'bad','rules'=>[]]]]]] as $bad) {
        $reject(fn()=>App\Services\V2boxFeatures::validate($bad,true),'Malformed/retired native syntax rejected');
    }
    foreach ([['route'=>['final'=>'missing']],['route'=>['rules'=>[['outbound'=>'missing']]]],['dns'=>['servers'=>[['type'=>'local','tag'=>'local']],'rules'=>[['action'=>'route','server'=>'missing']]]],['route'=>['rules'=>[['rule_set'=>['missing'],'action'=>'reject']]]],['outbounds'=>[['type'=>'socks','tag'=>'proxy','server'=>'example.test','server_port'=>1080,'domain_resolver'=>'missing']]]] as $bad) {
        $reject(fn()=>App\Services\V2boxFeatures::validate($bad,true),'Unresolved merged configuration reference rejected');
    }
    $base=['group_id'=>[999998],'name'=>'Route test','host'=>'example.test','port'=>'443','server_port'=>443,'protocol'=>'vless','tls'=>0,'network'=>'tcp','disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','up_mbps'=>0,'down_mbps'=>0];
    $old=ServerRoute::create(['remarks'=>'shared before migration','match'=>'["domain:example.test"]','action'=>'block','backend'=>'v2node']);
    $legacy=ServerV2box::create($base+['route_id'=>[$old->id]]);
    $native=['route'=>['rules'=>[['domain_suffix'=>['example.test'],'action'=>'reject']],'final'=>'direct']];
    $box=ServerV2box::create($base+['route_id'=>[$old->id],'sing_box'=>$native]);
    $migration=require __DIR__.'/../database/migrations/2026_10_11_000004_separate_node_routes.php';
    $migration->up();$box->refresh();$legacy->refresh();
    $assert($legacy->route_id!==[$old->id], 'Legacy V2Box rule cloned');
    $clone=ServerRoute::findOrFail($legacy->route_id[0]);
    $assert($clone->backend==='v2box' && $clone->action===$old->action && $clone->match===$old->match,'Legacy clone keeps behavior');
    $assert($box->sing_box===null && NodeRouteService::forNode($box)===$native, 'Inline native configuration migrated losslessly');
    $before=$box->route_id;$migration->up();$box->refresh();
    $assert($box->route_id===$before,'Migration data step is restartable');
    $nativeId=$box->route_id[0];
    foreach (['v2box'] as $backend) {
        $routes=$admin->fetch(Request::create('/','GET',['backend'=>$backend]))['data'];
        $assert($routes->every(fn($r)=>$r->backend===$backend),'Catalog filtered by backend');
        $assert($routes->firstWhere('id',$nativeId)->node_count===1,'Catalog counts service references');
        $assert($routes->firstWhere('id',$nativeId)->used_by===[['id'=>$box->id,'name'=>'Route test']],'Catalog identifies referenced services without extra queries');
        $assert($routes->firstWhere('id',$clone->id)->node_count===1,'Legacy V2Box references remain visible');
    }
    $reject(fn()=>(new V2boxController())->save($request($base+['id'=>$box->id,'route_id'=>[$old->id]])),'V2Box rejects Xray reference');
    $reject(fn()=>NodeRouteService::selected([2147483647],'v2box'),'Missing route rejected');
    $reject(fn()=>$admin->save($request(['id'=>$old->id,'backend'=>'v2box','remarks'=>'wrong','action'=>'block','match'=>['x']])),'Existing rule backend immutable');
    $reject(fn()=>$admin->drop($request(['id'=>$nativeId])),'Selected rule cannot be deleted');
    $second=ServerRoute::create(['backend'=>'v2box','remarks'=>'second','match'=>'[]','action'=>'sing_box','sing_box'=>['route'=>['rules'=>[['ip_cidr'=>['10.0.0.0/8'],'action'=>'reject']],'final'=>'direct']]]);
    (new V2boxController())->save($request($base+['id'=>$box->id,'route_id'=>[$nativeId,$second->id]]));
    $box->refresh();$merged=NodeRouteService::forNode($box);
    $assert(count($merged['route']['rules'])===2 && isset($merged['route']['rules'][0]['domain_suffix']) && isset($merged['route']['rules'][1]['ip_cidr']),'Multiple rules merge in selected order');
    $reject(fn()=>$admin->save($request(['id'=>$second->id,'backend'=>'v2box','remarks'=>'conflict','action'=>'sing_box','sing_box'=>['route'=>['final'=>'proxy']]])),'Editing rule rejects conflicts on assigned nodes');
    $assert($second->fresh()->sing_box['route']['final']==='direct','Failed rule edit rolls back');
    $reject(fn()=>(new V2boxController())->save($request($base+['id'=>$box->id,'route_id'=>[$nativeId,$clone->id]])),'Native and legacy cannot silently override each other');
    $assert($box->fresh()->route_id===[$nativeId,$second->id],'Invalid selection preserves previous selection');
    foreach ([['route'=>['rules'=>'bad']],['route'=>['rule_set'=>[['type'=>'inline','tag'=>'x'],['type'=>'inline','tag'=>'x']]]],['inbounds'=>[]]] as $bad) {
        $reject(fn()=>$admin->save($request(['backend'=>'v2box','remarks'=>'bad','action'=>'sing_box','sing_box'=>$bad])),'Malformed native config rejected');
    }
    $out=['type'=>'socks','tag'=>'proxy','server'=>'127.0.0.1','server_port'=>1080];
    $a=new ServerRoute(['action'=>'sing_box','sing_box'=>['outbounds'=>[$out]]]);
    $b=new ServerRoute(['action'=>'sing_box','sing_box'=>['outbounds'=>[$out]]]);
    $assert(count(NodeRouteService::native(collect([$a,$b]))['outbounds'])===1,'Identical outbound tags deduplicated');
    $b->sing_box=['outbounds'=>[array_replace($out,['server_port'=>1081])]];
    $reject(fn()=>NodeRouteService::native(collect([$a,$b])),'Conflicting outbound definitions rejected');
    $fragment=new ServerRoute(['action'=>'sing_box','sing_box'=>['route'=>['rules'=>[['domain_suffix'=>['example.test'],'action'=>'route','outbound'=>'proxy']]]]]);
    App\Services\V2boxFeatures::validate($fragment->sing_box);
    $assert(count(NodeRouteService::native(collect([$a,$fragment]))['outbounds'])===1,'References may resolve across selected fragments');
    $reject(fn()=>NodeRouteService::native(collect([$fragment])),'Unresolved fragment cannot be assigned alone');
    foreach (['v2box'=>[$box,new V2boxController()]] as $backend=>[$node,$controller]) {
        $controller->save($request(array_replace($base,['id'=>$node->id,'name'=>'stale name '.$backend,'listen_ip'=>'127.0.0.1','route_id'=>$node->route_id])));
        $assert($node->fresh()->name==='Route test' && $node->fresh()->listen_ip==='127.0.0.1','Persisted service technical settings can be edited without changing default line name');
    }
    $config=App\Services\Actions\NodeV10Config::build($box->fresh());
    $assert($config['singBox']['route']->rules===$merged['route']['rules'] && $config['routes']===[], 'V10 resolves native catalog rules');
    $legacyConfig=App\Services\Actions\NodeConfiguration::build($box->fresh());
    $assert(json_encode($legacyConfig['sing_box'])===json_encode($config['singBox']),'Both communication APIs deliver identical native routing');
    $legacyApi=(new App\Http\Controllers\V2\Server\ServerController())->config(Request::create('/','GET',['node_type'=>'v2box','node_id'=>$box->id,'token'=>config('v2board.server_token')]));
    $legacyBody=json_decode($legacyApi->getContent(),true);
    $assert(($legacyBody['sing_box']['route']['rules']??null)===$merged['route']['rules'],'Authenticated legacy HTTP config contains native rules');
    $beforeHash=$legacyApi->headers->get('ETag');
    $second->update(['sing_box'=>['route'=>['rules'=>[['ip_cidr'=>['192.0.2.0/24'],'action'=>'reject']],'final'=>'direct']]]);
    $updatedApi=(new App\Http\Controllers\V2\Server\ServerController())->config(Request::create('/','GET',['node_type'=>'v2box','node_id'=>$box->id,'token'=>config('v2board.server_token')]));
    $assert($updatedApi->headers->get('ETag')!==$beforeHash,'Native rule edits change legacy configuration version');
    $cachedRequest=Request::create('/','GET',['node_type'=>'v2box','node_id'=>$box->id,'token'=>config('v2board.server_token')]);
    $cachedRequest->headers->set('If-None-Match',$updatedApi->headers->get('ETag'));
    $assert((new App\Http\Controllers\V2\Server\ServerController())->config($cachedRequest)->getStatusCode()===304,'Unchanged legacy configuration accepts the quoted version sent by V2Box');
    $second->update(['sing_box'=>['route'=>['rules'=>[['ip_cidr'=>['10.0.0.0/8'],'action'=>'reject']],'final'=>'direct']]]);
    if ($fixture=getenv('NODE_ROUTING_FIXTURE')) {
        file_put_contents($fixture,json_encode(['legacy'=>json_decode($legacyApi->getContent(),true),'v10'=>['data'=>$config,'meta'=>['configurationHash'=>hash('sha256',json_encode($config))]]],JSON_THROW_ON_ERROR));
    }
    $old->update(['match'=>'["changed.test"]']);
    $assert($clone->fresh()->match!==$old->fresh()->match,'Xray edit does not affect migrated V2Box rules');

    // Retired conversions must not create a target or mutate the saved node.
    $before=ServerV2box::count();
    foreach (['v2node','v2box'] as $sourceType) {
        $reject(fn()=>(new V2boxController())->save($request($base+['source_type'=>$sourceType,'source_id'=>$box->id])),'Backend conversion rejected');
    }
    $assert(ServerV2box::count()===$before && $box->fresh()->route_id===[$nativeId,$second->id],'Rejected conversions preserve node identity and rules');
    App\Services\NodeMaintenance::save('v2box',$legacy->id,['enabled'=>true,'reason'=>'maintenance','endsAt'=>time()+3600,'hideSubscription'=>true]);
    (new V2boxController())->drop($request(['id'=>$legacy->id]));
    $assert(!DB::table('v2_node_maintenance')->where('type','v2box')->where('node_id',$legacy->id)->exists(),'Deletion removes maintenance record');
    echo "PASS: $checks independent node routing checks\n";
} finally { DB::rollBack(); }
