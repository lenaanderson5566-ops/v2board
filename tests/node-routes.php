<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\ServerRoute;
use App\Models\ServerV2box;
use App\Models\ServerV2node;
use App\Services\NodeRouteService;
use App\Http\Controllers\V1\Admin\Server\RouteController;
use App\Http\Controllers\V1\Admin\Server\V2boxController;
use App\Http\Controllers\V1\Admin\Server\V2nodeController;
set_exception_handler(function($e) { fwrite(STDERR, $e->getMessage()."\n".$e->getTraceAsString()."\n"); exit(1); });
$checks=0;
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
    $base=['group_id'=>[999998],'name'=>'Route test','host'=>'example.test','port'=>'443','server_port'=>443,'protocol'=>'vless','tls'=>0,'network'=>'tcp','disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','up_mbps'=>0,'down_mbps'=>0];
    $old=ServerRoute::create(['remarks'=>'shared before migration','match'=>'["domain:example.test"]','action'=>'block']);
    $xray=ServerV2node::create($base+['route_id'=>[$old->id]]);
    $legacy=ServerV2box::create($base+['route_id'=>[$old->id]]);
    $native=['route'=>['rules'=>[['domain_suffix'=>['example.test'],'action'=>'reject']],'final'=>'direct']];
    $box=ServerV2box::create($base+['route_id'=>[$old->id],'sing_box'=>$native]);
    $migration=require __DIR__.'/../database/migrations/2026_10_11_000004_separate_node_routes.php';
    $migration->up();$box->refresh();$legacy->refresh();$xray->refresh();
    $assert($xray->route_id===[$old->id], 'Xray references remain unchanged');
    $assert($legacy->route_id!==[$old->id], 'Legacy V2Box rule cloned');
    $clone=ServerRoute::findOrFail($legacy->route_id[0]);
    $assert($clone->backend==='v2box' && $clone->action===$old->action && $clone->match===$old->match,'Legacy clone keeps behavior');
    $assert($box->sing_box===null && NodeRouteService::forNode($box)===$native, 'Inline native configuration migrated losslessly');
    $before=$box->route_id;$migration->up();$box->refresh();
    $assert($box->route_id===$before,'Migration data step is restartable');
    $nativeId=$box->route_id[0];
    foreach (['v2node','v2box'] as $backend) {
        $routes=$admin->fetch(Request::create('/','GET',['backend'=>$backend]))['data'];
        $assert($routes->every(fn($r)=>$r->backend===$backend),'Catalog filtered by backend');
    }
    $reject(fn()=>(new V2nodeController())->save($request($base+['id'=>$xray->id,'route_id'=>[$nativeId]])),'Xray rejects sing-box reference');
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
    foreach (['v2node'=>[$xray,new V2nodeController()], 'v2box'=>[$box,new V2boxController()]] as $backend=>[$node,$controller]) {
        $controller->save($request(array_replace($base,['id'=>$node->id,'name'=>'edited '.$backend,'route_id'=>$node->route_id])));
        $assert($node->fresh()->name==='edited '.$backend,'Persisted node can be edited');
    }
    $config=App\Services\Actions\NodeV10Config::build($box->fresh());
    $assert($config['singBox']['route']->rules===$merged['route']['rules'] && $config['routes']===[], 'V10 resolves native catalog rules');
    $old->update(['match'=>'["changed.test"]']);
    $assert($clone->fresh()->match!==$old->fresh()->match,'Xray edit does not affect migrated V2Box rules');

    // A colliding ID in the other table must never be interpreted as the source.
    $existingTarget=ServerV2box::create($base+['route_id'=>[]]);
    $source=ServerV2node::create(array_replace($base,['name'=>'conversion source','route_id'=>[$old->id],'tags'=>['keep'],'show'=>1]));
    $originalId=$source->id;$created=$source->created_at;
    App\Services\NodeMaintenance::save('v2node',$originalId,['enabled'=>true,'reason'=>'转换维护','endsAt'=>time()+3600,'hideSubscription'=>true]);
    $sourceKey=App\Services\NodeCredentials::issue('v2node',$originalId,1);
    $converted=(new V2boxController())->save($request(array_replace($base,['source_type'=>'v2node','source_id'=>$originalId,'route_id'=>[$nativeId]])));
    $targetId=json_decode($converted->getContent(),true)['data']['id'];
    $target=ServerV2box::findOrFail($targetId);
    $assert(isset(App\Services\NodeMaintenance::active()['v2box:'.$targetId]) && !isset(App\Services\NodeMaintenance::active()['v2node:'.$originalId]),'Maintenance follows conversion identity');
    $assert(App\Services\NodeCredentials::migrated('v2box',$targetId),'Conversion preserves no-global-fallback policy');
    $assert(DB::table('v2_node_credential')->where('id',$sourceKey['id'])->value('revoked_at')!==null,'Conversion revokes source credentials');
    $assert(!ServerV2node::find($originalId) && $target->route_id===[$nativeId], 'Conversion moves source and selects target rules');
    $assert($target->created_at===$created && $target->tags===['keep'] && (int)$target->show===1,'Conversion preserves key seed and metadata');
    $assert(ServerV2box::find($existingTarget->id)!==null,'Existing target node untouched');
    $reverse=(new V2nodeController())->save($request($base+['source_type'=>'v2box','source_id'=>$targetId]));
    $reverseId=json_decode($reverse->getContent(),true)['data']['id'];
    $assert(!ServerV2box::find($targetId) && ServerV2node::findOrFail($reverseId)->route_id===[], 'Reverse conversion clears source backend rules');
    $child=ServerV2node::create($base+['service_id'=>$reverseId]);
    $reject(fn()=>(new V2boxController())->save($request($base+['source_type'=>'v2node','source_id'=>$reverseId])),'Parent cannot move while children reference it');
    $assert(ServerV2node::find($reverseId)!==null,'Rejected conversion retains original node');
    $reject(fn()=>(new V2boxController())->save($request($base+['source_type'=>'v2node','source_id'=>$reverseId,'id'=>$existingTarget->id])),'Source identity cannot be combined with target update ID');
    $reject(fn()=>(new V2nodeController())->save($request(array_replace($base,['protocol'=>'naive','source_type'=>'v2box','source_id'=>$existingTarget->id]))),'Unsupported target protocol rejected');
    $child->delete();
    (new V2nodeController())->drop($request(['id'=>$reverseId]));
    $assert(!DB::table('v2_node_maintenance')->where('type','v2node')->where('node_id',$reverseId)->exists(),'Node deletion removes maintenance record');
    echo "PASS: $checks independent node routing checks\n";
} finally { DB::rollBack(); }
