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
$targetPrefix = 'target-statistics-test-'.bin2hex(random_bytes(12)).':';
config(['cache.stores.target_statistics.prefix'=>$targetPrefix,'cache.target_statistics_budget_mb'=>64]);
Cache::purge('target_statistics');
config(['cache.stores.node_deployment.prefix'=>$targetPrefix.'deployment:']);
Cache::purge('node_deployment');
Queue::fake();
$kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
$nodeId=0;
$call=function($method,$path,$body=[],$headers=[])use($kernel,&$nodeId){
    $server=array_merge(['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer node-v10-test-secret','HTTP_X_NODE_TYPE'=>'v2box','HTTP_X_NODE_ID'=>(string)$nodeId,'HTTP_X_NODE_CAPABILITIES'=>'native-routing-v1,dns-v1,outbounds-v1'], $headers);
    $request=Request::create($path,$method,[],[],[],$server,json_encode($body));
    return $kernel->handle($request);
};
(require __DIR__.'/../database/migrations/2026_10_21_000001_create_node_target_snapshots.php')->up();
(require __DIR__.'/../database/migrations/2026_10_21_000002_create_node_target_daily.php')->up();
// Explicit opt-in load fixture; never populate an ordinary application database.
if (getenv('TARGET_STATISTICS_PERF')==='1') {
    if(DB::getDriverName()!=='mysql' || !str_starts_with(DB::connection()->getDatabaseName(),'v2board_test_'))throw new RuntimeException('Performance fixture requires an isolated MySQL test database');
    Illuminate\Support\Facades\Schema::create('v2_risk_setting',function($t){$t->increments('id');$t->string('key')->unique();$t->text('value');$t->integer('created_at');$t->integer('updated_at');});
    $daily=app(App\Services\TargetStatisticsDaily::class);$store=app(App\Services\TargetStatisticsStore::class);
    if(DB::table($daily::TABLE)->exists())throw new RuntimeException('Performance fixture requires empty target tables');
    config(['cache.target_statistics_daily_max_rows'=>400000]);
    $midnight=intdiv(time(),86400)*86400;$start=microtime(true);
    for($node=1;$node<=20;$node++)for($offset=0;$offset<30;$offset++) {
        $day=$midnight-$offset*86400;$rows=[];
        for($i=0;$i<500;$i++) {
            $target='target'.$i.'.test';$rows[]=['id'=>hash('sha256',$node.'|'.$day.'|domain|'.$target),'node_id'=>$node,'day_at'=>$day,'expires_at'=>$day+30*86400,'type'=>'domain','target'=>$target,'connections'=>1,'upload_bytes'=>100,'download_bytes'=>200,'total_bytes'=>300];
        }
        DB::table($daily::TABLE)->insert($rows);
        DB::table($daily::DAYS)->insert(['id'=>hash('sha256',$node.'|'.$day),'node_id'=>$node,'day_at'=>$day,'expires_at'=>$day+30*86400,'target_count'=>500,'omitted'=>0,'source_dropped'=>0,'last_bucket_at'=>$day]);
    }
    $metrics=['rows'=>DB::table($daily::TABLE)->count(),'seedSeconds'=>round(microtime(true)-$start,3)];
    foreach([1,600] as $page){$start=microtime(true);$r=$daily->report(1,30,$page);$metrics['page'.$page.'Ms']=round((microtime(true)-$start)*1000,2);$assert($r['total']===15000 && count($r['rows'])===25,'Thirty-day node page has bounded results');}
    $start=microtime(true);$daily->report(1,30,1);$metrics['warmPage1Ms']=round((microtime(true)-$start)*1000,2);
    DB::enableQueryLog();DB::flushQueryLog();$daily->report(1,30,1);$queries=DB::getQueryLog();DB::disableQueryLog();
    $assert(!collect($queries)->contains(fn($q)=>str_contains($q['query'],'count(*)') && str_contains($q['query'],'v2_node_target_daily') && !str_contains($q['query'],'where')),'Warm report never counts all nodes');
    foreach($queries as $q)if(str_contains($q['query'],'order by')&&str_contains($q['query'],'v2_node_target_daily'))$metrics['pagePlan']=DB::select('EXPLAIN '.$q['query'],$q['bindings']);
    $metrics['cleanupPlan']=DB::select('EXPLAIN SELECT id FROM v2_node_target_daily WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000',[time()]);
    $assert(!str_contains(json_encode($metrics['pagePlan']),'filesort'),'Daily page follows reverse index order without filesort');
    $version=(string)Illuminate\Support\Str::uuid();$store->publishPolicy(['enabled'=>true,'version'=>$version,'retentionHours'=>24,'dailyRetentionDays'=>30,'reportIntervalSeconds'=>60,'leaseSeconds'=>120]);
    $prepared=[];for($i=0;$i<500;$i++)$prepared[]=['key'=>hash('sha256','1|domain|target'.$i.'.test'),'meta'=>json_encode(['userId'=>1,'type'=>'domain','target'=>'target'.$i.'.test']),'connections'=>1,'uploadBytes'=>100,'downloadBytes'=>200];
    for($node=1;$node<=20;$node++)$store->ingest($node,$version,(string)Illuminate\Support\Str::uuid(),'perf-'.$node,$prepared,0,100,intdiv(time(),300)*300-600);
    $start=microtime(true);$result=app(App\Services\TargetStatisticsArchive::class)->flush();$metrics['archive20x500Ms']=round((microtime(true)-$start)*1000,2);$assert($result['savedBuckets']===20,'Twenty full node buckets archived');
    $start=microtime(true);$daily->prune(30);$metrics['emptyCleanupMs']=round((microtime(true)-$start)*1000,2);
    DB::table($daily::TABLE)->where('day_at',$midnight-29*86400)->update(['expires_at'=>time()-1]);
    $before=DB::table($daily::TABLE)->count();$start=microtime(true);$daily->prune(30);$metrics['cleanup1000Ms']=round((microtime(true)-$start)*1000,2);$assert($before-DB::table($daily::TABLE)->count()===1000,'Cleanup deletes at most one thousand rows per pass');
    $start=microtime(true);$daily->scheduleShorten(7);$metrics['scheduleShortenMs']=round((microtime(true)-$start)*1000,2);$assert($daily->report(1,7,1)['total']===3500,'Shortened policy hides older rows before physical cleanup');
    $start=microtime(true);$updated=$daily->runCleanup();$metrics['cleanupExpiry5000Ms']=round((microtime(true)-$start)*1000,2);$assert($updated<=5000 && $daily->cleanupPending(),'Expiry rewrite bounded to five thousand rows');
    $metrics['peakMiB']=round(memory_get_peak_usage(true)/1048576,2);echo json_encode($metrics,JSON_PRETTY_PRINT)."\n";
    $store->connection()->eval("local keys=redis.call('KEYS',KEYS[1]..'*'); for _,k in ipairs(keys) do redis.call('DEL',k) end; return #keys",1,$targetPrefix);
    exit(0);
}
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
    $r=$call('POST',$root.'/capabilities',['agentVersion'=>'v1.0.11','coreVersion'=>'v1.14.3','features'=>[]]);
    $assert($r->getStatusCode()===200 && Cache::get('V2BOX_CAPABILITIES:'.$node->id)['agentVersion']==='v1.0.11','Running agent release cached separately from core');
    $runtime=App\Services\NodeRuntimeService::inspect('v2box',$node);
    $assert($runtime['agentVersion']==='v1.0.11' && $runtime['coreVersion']==='v1.14.3' && !empty($runtime['capabilitiesReportedAt']),'Admin runtime exposes actual versions and observation time');
    $r=$call('POST',$root.'/capabilities',['agentVersion'=>'<invalid>','coreVersion'=>'v1.14.3','features'=>[]]);
    $assert($r->getStatusCode()===422,'Invalid agent version rejected');
    $r=$call('GET',$root.'/configuration');$body=json_decode($r->getContent(),true);
    $assert(str_contains($r->headers->get('Cache-Control',''),'no-store'),'Node configuration containing credentials must not be cached');
    $assert($r->getStatusCode()===200 && $body['data']['listenPort']===443 && $body['data']['singBox']===$native,'V10 config projection: '.$r->getStatusCode().' '.$r->getContent());
    $assert(!isset($body['data']['server_port']),'No legacy field naming');
    $assert(($body['meta']['configurationHash']??null)===trim($r->headers->get('ETag'),'"'),'Configuration receipt hash survives ETag weakening/removal via explicit metadata');
    $assert($body['meta']['configurationHash']===hash('sha256',json_encode(App\Services\Actions\NodeV10Config::build($node->fresh()))),'Receipt metadata identifies exactly the authoritative configuration');
    $assert(is_object(json_decode($r->getContent())->data->tlsSettings),'Empty TLS settings encoded as object');
    $assert(is_object(json_decode($r->getContent())->data->networkSettings) && is_object(json_decode($r->getContent())->data->encryptionSettings),'Empty protocol settings encoded as objects');
    $assert($call('GET',$root.'/configuration',[],['HTTP_IF_NONE_MATCH'=>$r->headers->get('ETag')])->getStatusCode()===304,'Config ETag');
    $assert($call('GET',$root.'/configuration',[],['HTTP_X_NODE_CAPABILITIES'=>''])->getStatusCode()===409,'Capability guard');
    $tag=$r->headers->get('ETag');
    $hash=trim($tag,'"');
    $receipt=['coreVersion'=>'v1.14.3','features'=>['native-routing-v1','configuration-receipt-v1'],
        'configuration'=>['hash'=>$hash,'state'=>'applied']];
    $assert($call('POST',$root.'/capabilities',$receipt)->getStatusCode()===200,'Applied receipt accepted');
    $runtime=App\Services\NodeRuntimeService::inspect('v2box',$node);
    $assert($runtime['applicationState']==='applied' && $runtime['lastAppliedAt']!==null,'Exact served configuration confirmed');
    $lastApplied=$runtime['lastAppliedAt'];
    App\Services\NodeRuntimeService::invalidate('v2box',$node->id);
    $assert(App\Services\NodeRuntimeService::inspect('v2box',$node)['applicationState']==='unconfirmed','Saved change cannot reuse a previously served acknowledgement');
    $listed=App\Services\NodeRuntimeService::decorate([['id'=>$node->id,'type'=>'v2box','show'=>0]]);
    $assert($listed[0]['application_state']==='unconfirmed','Node list also invalidates the previous applied indicator');
    $call('POST',$root.'/capabilities',$receipt);
    $assert(App\Services\NodeRuntimeService::inspect('v2box',$node)['applicationState']==='unconfirmed','Delayed receipt cannot acknowledge a configuration not served after save');
    $call('GET',$root.'/configuration');
    $assert(App\Services\NodeRuntimeService::inspect('v2box',$node)['lastAppliedAt']===$lastApplied,'Invalidation retains historical success time');

    $failed=$receipt;$failed['configuration']=['hash'=>$hash,'state'=>'failed','errorCode'=>'core'];
    $assert($call('POST',$root.'/capabilities',$failed)->getStatusCode()===200,'Bounded failure receipt accepted');
    $runtime=App\Services\NodeRuntimeService::inspect('v2box',$node);
    $assert($runtime['applicationState']==='failed' && $runtime['lastAppliedAt']===$lastApplied && $runtime['errorCode']==='core','Failure preserves last success');
    $stale=$receipt;$stale['configuration']['hash']=str_repeat('0',64);
    $assert($call('POST',$root.'/capabilities',$stale)->getStatusCode()===200,'Delayed report does not interrupt capabilities');
    $assert(App\Services\NodeRuntimeService::inspect('v2box',$node)['applicationState']==='failed','Stale receipt cannot confirm latest config');
    foreach ([['hash'=>'bad','state'=>'applied'],['hash'=>$hash,'state'=>'failed'],['hash'=>$hash,'state'=>'failed','errorCode'=>'secret text'],['hash'=>$hash,'state'=>'applied','exception'=>'secret']] as $invalid) {
        $bad=$receipt;$bad['configuration']=$invalid;
        $assert($call('POST',$root.'/capabilities',$bad)->getStatusCode()===422,'Malformed or sensitive receipt rejected');
    }
    $assert($call('POST',$root.'/capabilities',$receipt,['HTTP_AUTHORIZATION'=>'Bearer wrong'])->getStatusCode()===401,'Receipt requires node authentication');

    $updated=$native;$updated['route']['rules'][]=['domain_suffix'=>['updated.test'],'action'=>'reject'];
    $profile->update(['sing_box'=>$updated]);
    $changed=$call('GET',$root.'/configuration',[],['HTTP_IF_NONE_MATCH'=>$tag]);
    $assert($changed->getStatusCode()===200 && $changed->headers->get('ETag')!==$tag,'Catalog rule edit changes configuration ETag');
    $assert(App\Services\NodeRuntimeService::inspect('v2box',$node)['applicationState']==='unconfirmed','Changed hash invalidates old receipt');
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
    $maintenance=App\Services\NodeMaintenance::class;
    $child=$node->replicate();$child->name='maintenance child';$child->service_id=$nodeId;$child->save();
    $maintenance::save('v2box',$nodeId,['enabled'=>true,'reason'=>'maintenance-test','endsAt'=>time()+3600,'hideSubscription'=>true]);
    $assert(!collect((new App\Services\ServerService())->getAvailableV2node($user,'v2box'))->contains('id',$nodeId),'Maintenance hides new subscription entry');
    $assert(!collect((new App\Services\ServerService())->getAvailableV2node($user,'v2box'))->contains('id',$child->id),'Parent maintenance hides child subscription');
    $preview=json_decode((new App\Services\Actions\User\ServerActions())->previews(Request::create('/'))->getContent(),true)['data'];
    $assert(!collect($preview)->contains(fn($n)=>$n['type']==='v2box' && in_array($n['id'],[$nodeId,$child->id],true)),'Public preview respects maintenance hiding');
    $assert(json_decode($call('GET',$root.'/users')->getContent(),true)['data']!==null,'Maintenance does not deny node user pulls');
    $maintenance::save('v2box',$nodeId,['enabled'=>false]);
    $assert(collect((new App\Services\ServerService())->getAvailableV2node($user,'v2box'))->contains('id',$child->id),'Ending maintenance restores child without overwriting show');
    $child->delete();
    $public=(new App\Services\ServerService())->getAvailableV2node($user,'v2box');
    foreach($public as $item) $assert(!array_key_exists('sing_box',$item),'Server credentials hidden from subscribers');
    $stats=app(App\Services\TargetStatistics::class);
    $assert($stats->policy()['enabled']===false,'Target statistics defaults off');
    $assert($stats->policy()['reportIntervalSeconds']===60,'Existing installation defaults to 60 second reports');
    $capabilityKey='V2BOX_CAPABILITIES:'.$nodeId;$originalCapabilities=Cache::get($capabilityKey);
    $oldNode=$stats->report($nodeId,0,1)['nodes'];
    $assert(collect($oldNode)->firstWhere('id',$nodeId)['configurableInterval']===false,'Older node marked fixed cadence');
    Cache::put($capabilityKey,['features'=>['target-statistics-v1','target-statistics-interval-v1']],60);
    $newNode=$stats->report($nodeId,0,1)['nodes'];
    $assert(collect($newNode)->firstWhere('id',$nodeId)['configurableInterval']===true,'New node cadence capability exposed');
    Cache::put($capabilityKey,$originalCapabilities,86400);

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
    $changedCadence=$stats->configure(null,300);
    $assert($changedCadence['version']===$policy['version'] && $stats->report($nodeId,0,1)['total']===2,'Cadence adjustment preserves active collected rows');
    $stats->configure(null,60);
    $assert($report['rows'][0]['target']==='example.com' && $report['rows'][1]['target']==='2001:db8::1','Domain and IP normalized');
    $assert($stats->report($nodeId,2147483646,1)['total']===0,'User filter isolated');
    $changed=$batch;$changed['records'][0]['uploadBytes']=999;
    $assert($call('POST',$root.'/target-statistics',$changed)->getStatusCode()===409,'Mutated retry rejected');
    $bad=$batch;$bad['batchId']=(string)Illuminate\Support\Str::uuid();$bad['records'][0]['target']='https://example.com/private?token=secret';
    $assert($call('POST',$root.'/target-statistics',$bad)->getStatusCode()===422,'Full URLs rejected');
    $assert($stats->report($nodeId,0,1)['total']===2,'Invalid batch not partially written');
    $bad=$batch;$bad['batchId']=(string)Illuminate\Support\Str::uuid();$bad['records'][0]['uploadBytes']=-1;
    $assert($call('POST',$root.'/target-statistics',$bad)->getStatusCode()===422,'Negative target traffic rejected');
    $requestBody = function($raw,$headers=[])use($kernel,$root,&$nodeId) {
        return $kernel->handle(Request::create($root.'/target-statistics','POST',[],[],[],array_merge([
            'CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer node-v10-test-secret',
            'HTTP_X_NODE_TYPE'=>'v2box','HTTP_X_NODE_ID'=>(string)$nodeId],$headers),$raw));
    };
    $assert($requestBody(str_repeat(' ',262145))->getStatusCode()===413,'Raw request size bounded without Content-Length');
    $assert($requestBody('{}',['CONTENT_LENGTH'=>'262145'])->getStatusCode()===413,'Declared oversized request rejected before decode');
    $assert($requestBody('{')->getStatusCode()===400,'Malformed JSON rejected');
    $assert($requestBody('{}',['HTTP_CONTENT_ENCODING'=>'gzip'])->getStatusCode()===415,'Unsupported compression rejected');
    $huge=$batch;$huge['batchId']=(string)Illuminate\Support\Str::uuid();
    $huge['records'][0]['uploadBytes']=1000000000000000;$huge['records'][1]['uploadBytes']=1;
    $assert($call('POST',$root.'/target-statistics',$huge)->getStatusCode()===422,'Whole batch integer bound prevents Redis overflow');
    $headerResponse=$call('GET',$root.'/configuration',[],['HTTP_X_NODE_CAPABILITIES'=>'native-routing-v1,target-statistics-policy-v2']);
    $headerPolicy=json_decode($headerResponse->headers->get('X-Target-Statistics-Policy'),true);
    $assert($headerPolicy['version']===$policy['version'],'Configuration carries optional statistics policy');
    $notModified=$call('GET',$root.'/configuration',[],['HTTP_X_NODE_CAPABILITIES'=>'native-routing-v1,target-statistics-policy-v2','HTTP_IF_NONE_MATCH'=>$headerResponse->headers->get('ETag')]);
    $assert($notModified->getStatusCode()===304 && $notModified->headers->has('X-Target-Statistics-Policy'),'304 renews optional lease without config reload');
    $store=app(App\Services\TargetStatisticsStore::class);
    config(['cache.target_statistics_budget_mb'=>-1]);$assert($store->budgetBytes()===8*1024*1024,'Budget has a safe lower bound');
    config(['cache.target_statistics_budget_mb'=>999999]);$assert($store->budgetBytes()===1024*1024*1024,'Budget has a safe upper bound');
    config(['cache.target_statistics_budget_mb'=>64]);
    $usage=$store->usage();
    $assert($usage['acceptedBatches']===1 && $usage['duplicateBatches']===1 && $usage['usedBytes']>0,'Capacity and batch metrics exposed');
    $prepared=[['key'=>hash('sha256','exact'),'meta'=>json_encode(['userId'=>1,'type'=>'domain','target'=>'exact.test']), 'connections'=>1,'uploadBytes'=>1000000000000000,'downloadBytes'=>0]];
    $assert($stats->policy()['retentionHours']===1,'Existing retention remains one hour');
    $longPolicy=$stats->configure(null,null,24);
    $assert($longPolicy['version']===$policy['version'],'Retention change preserves generation');
    $oldTime=intdiv(time(),300)*300-7200;
    $store->ingest(999997,$policy['version'],(string)Illuminate\Support\Str::uuid(),'retention',$prepared,0,100,$oldTime);
    $oldKey=$store->prefix().'999997:'.$oldTime;
    $assert($store->connection()->ttl($oldKey)>75000,'Extended retention uses physical Redis TTL');
    $assert(count($store->report(999997,$policy['version'],24)['rows'])===1,'Report includes buckets older than one hour');
    $assert(count($store->report(999997,$policy['version'],1)['rows'])===0,'Short window excludes older buckets');
    $archive=app(App\Services\TargetStatisticsArchive::class);
    $archiveResult=$archive->flush();
    $assert($archiveResult['savedBuckets']>=1,'Completed bucket archived in SQL: '.json_encode($archiveResult));
    $assert(!$store->connection()->exists($oldKey),'Archived bucket releases Redis payload');
    $existingSnapshot=DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('node_id',999997)->first();
    DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('id',$existingSnapshot->id)->update(['payload_bytes'=>$archive->budget()]);
    $store->ingest(999995,$policy['version'],(string)Illuminate\Support\Str::uuid(),'database-budget',$prepared,0,100,$oldTime);
    $blockedArchive=$archive->flush();
    $assert($blockedArchive['full'] && $store->connection()->exists($store->prefix().'999995:'.$oldTime),'Database capacity pressure retains Redis data');
    DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('id',$existingSnapshot->id)->update(['payload_bytes'=>$existingSnapshot->payload_bytes]);

    $assert(count($store->report(999997,$policy['version'],24)['rows'])===1,'SQL history remains visible after Redis handoff');
    $archive->flush();
    $daily=app(App\Services\TargetStatisticsDaily::class);
    $dailyRows=$daily->report(999997,7,1);
    $assert($dailyRows['total']===1 && !isset($dailyRows['rows'][0]['userId']),'Daily archive strips user identity');
    $beforeDaily=$dailyRows['rows'][0]['connections'];
    $archive->flush();
    $assert($daily->report(999997,7,1)['rows'][0]['connections']===$beforeDaily,'Archive retry does not double count daily counters');
    $assert($daily->report(999996,7,1)['total']===0,'Daily query is node scoped');
    $assert($daily->report(999997,7,2)['rows']===[],'Daily query paginates in SQL');
    $remaining=1000; $sample=['m:a'=>json_encode(['userId'=>1,'type'=>'domain','target'=>'daily.test']),'c:a'=>3,'u:a'=>10,'d:a'=>20,'m:b'=>json_encode(['userId'=>2,'type'=>'domain','target'=>'daily.test']),'c:b'=>4,'u:b'=>5,'d:b'=>6];
    $daily->add(999994,time()-600,$sample,30,$remaining);
    $daily->add(999994,time()-400,$sample,30,$remaining);
    $r=$daily->report(999994,30,1);
    $assert($r['rows'][0]['connections']===14 && $r['rows'][0]['uploadBytes']===30 && $r['total']===1,'Daily merges users and buckets without storing identity');
    DB::table(App\Services\TargetStatisticsDaily::TABLE)->where('node_id',999994)->update(['expires_at'=>time()-1]);
    DB::table(App\Services\TargetStatisticsDaily::DAYS)->where('node_id',999994)->update(['expires_at'=>time()-1]);
    $remaining=0;$daily->add(999994,time()-400,$sample,30,$remaining);
    $assert($daily->report(999994,30,1)['rows'][0]['connections']===7,'Reenabled daily collection replaces expired counters without resurrecting history');
    $remaining=1000;$cross=[];for($i=0;$i<20;$i++){$cross['m:'.$i]=json_encode(['userId'=>1,'type'=>'domain','target'=>'page'.$i.'.test']);$cross['c:'.$i]=1;}
    $daily->add(999989,intdiv(time(),86400)*86400-86400,$cross,30,$remaining);$daily->add(999989,intdiv(time(),86400)*86400-2*86400,$cross,30,$remaining);
    $page1=$daily->report(999989,30,1);$page2=$daily->report(999989,30,2);
    $assert(count($page1['rows'])===25 && count($page2['rows'])===15 && $page1['total']===40,'Day-header pagination spans uneven daily counts');
    $keys=fn($rows)=>array_map(fn($r)=>$r['date'].'|'.$r['target'],$rows);
    $assert(count(array_unique(array_merge($keys($page1['rows']),$keys($page2['rows']))))===40,'Day-header pagination has no gaps or duplicates');
    $remaining=0; $daily->add(999993,time()-600,$sample,30,$remaining);
    $assert($daily->report(999993,30,1)['truncated'] && $daily->report(999993,30,1)['total']===0,'Daily capacity rejection is visible');
    $many=[];for($i=0;$i<501;$i++){ $many['m:'.$i]=json_encode(['userId'=>1,'type'=>'domain','target'=>'cap'.$i.'.test']);$many['c:'.$i]=1; }
    $remaining=1000;DB::enableQueryLog();DB::flushQueryLog();$daily->add(999991,time()-600,$many,30,$remaining);$writes=count(DB::getQueryLog());DB::disableQueryLog();
    $assert($daily->report(999991,30,1)['total']===500 && $daily->report(999991,30,1)['truncated'],'Daily per-node target cap is enforced');
    $assert($writes<15,'Daily 500-row bucket is batch-written with bounded query count');
    $remaining=1000;$daily->add(999990,time()-31*86400,$sample,30,$remaining);
    $assert($daily->report(999990,30,1)['total']===0,'Daily expired input is not resurrected');
    $remaining=1000;$daily->add(999992,time()-10*86400,$sample,30,$remaining);
    $assert($daily->report(999992,30,1)['total']===1 && $daily->report(999992,7,1)['total']===0,'Thirty day retention does not extend recent detail queries');
    $daily->scheduleShorten(7);while($daily->cleanupPending())$daily->runCleanup();
    $assert($daily->report(999992,30,1)['total']===0,'Shortened daily history cannot be restored by extension');

    $assert(DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('node_id',999997)->count()===1,'Archive retry does not duplicate snapshots');
    // Simulate a crash after SQL commit and before Redis release.
    $payload=json_decode(DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('node_id',999997)->value('payload'),true);
    $store->connection()->hmset($oldKey,$payload);$store->connection()->expire($oldKey,3600);
    $assert($store->report(999997,$policy['version'],24)['rows'][0]['uploadBytes']===1000000000000000,'SQL and Redis overlap never double counts');
    $store->connection()->eval("return redis.call('ZADD',KEYS[1],ARGV[1],KEYS[2])",2,$store->prefix().'expiry',$oldKey,time()+3600);
    $archive->flush();
    $assert($daily->report(999997,7,1)['rows'][0]['connections']===$beforeDaily,'Crash retry preserves daily exactly-once aggregation');
    $store->connection()->del($oldKey);

    $assert(count($store->report(999997,$policy['version'],24,999999)['rows'])===0,'User filter applies before aggregation');
    $usedBefore=$store->usage()['usedBytes'];
    $stats->configure(null,null,1);
    $assert(!$store->connection()->exists($oldKey),'Shorter retention deletes expired payload immediately');
    $assert($store->usage()['usedBytes']<=$usedBefore,'Shortening does not increase ledger capacity');
    $assert(DB::table(App\Services\TargetStatisticsArchive::TABLE)->where('node_id',999997)->count()===0,'Shortening prunes expired database snapshots');
    $stats->configure(null,null,24);
    $assert(count($store->report(999997,$policy['version'],24)['rows'])===0,'Increasing retention cannot restore expired payload');
    $assert(!array_key_exists('retentionHours',$stats->nodePolicy()),'Storage retention is not sent to node policy protocol');
    $bulk=[];
    for($i=0;$i<500;$i++) $bulk[]=['key'=>hash('sha256','cap'.$i),'meta'=>json_encode(['userId'=>1,'type'=>'domain','target'=>'cap'.$i.'.test']),'connections'=>1,'uploadBytes'=>1,'downloadBytes'=>0];
    for($j=0;$j<13;$j++) {
        $records=array_map(function($row)use($j){$row['key']=hash('sha256',$row['key'].$j);$meta=json_decode($row['meta'],true);$meta['target']=$j.'.'.$meta['target'];$row['meta']=json_encode($meta);return $row;},$bulk);
        $store->ingest(999996,$policy['version'],(string)Illuminate\Support\Str::uuid(),'cap'.$j,$records,0,100,intdiv(time(),300)*300-3600-$j*300);
    }
    $bounded=$store->report(999996,$policy['version'],24);
    $assert(count($bounded['rows'])===6000 && $bounded['truncated'],'Long report enforces aggregate bound and explicit partial marker');
    $stats->configure(null,null,1);
    $fixedNow=intdiv(time(),300)*300;
    $stableId=(string)Illuminate\Support\Str::uuid();
    $store->ingest(999999,$policy['version'],$stableId,'hash',$prepared,0,100,$fixedNow-300);
    $store->ingest(999999,$policy['version'],$stableId,'hash',$prepared,0,100,$fixedNow);
    $assert($store->report(999999,$policy['version'])['rows'][0]['uploadBytes']===1000000000000000,'Retry across bucket boundary stays deduplicated');
    $jobs=[];
    $prepared[0]['uploadBytes']=999999999999999;
    for($i=0;$i<11;$i++) $jobs[]=['version'=>$policy['version'],'batchId'=>(string)Illuminate\Support\Str::uuid(),'hash'=>'exact-'.$i,'rows'=>$prepared];
    $processes=[];$started=microtime(true);
    for($i=0;$i<8;$i++) {
        $pipes=[];
        $process=proc_open([PHP_BINARY,__DIR__.'/node-target-statistics-worker.php',$targetPrefix], [['pipe','r'],['pipe','w'],['pipe','w']], $pipes);
        $assert(is_resource($process),'Concurrent Redis worker started');
        fwrite($pipes[0],json_encode($jobs));fclose($pipes[0]);$processes[]=[$process,$pipes];
    }
    foreach($processes as [$process,$pipes]) {
        $output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        $assert(proc_close($process)===0,'Concurrent worker succeeded: '.$output);
    }
    $assert($store->report(999997,$policy['version'])['rows'][0]['uploadBytes']===10999999999999989,'Parallel retries accumulated exactly once above double precision');
    echo 'Redis parallel 88 submissions: '.round((microtime(true)-$started)*1000).' ms'."\n";
    $prefix=$store->prefix();
    // Admission failure must not create a dedup entry or partly merge counters.
    $used=$store->connection()->get($prefix.'used');
    $store->connection()->setex($prefix.'used',7200,App\Services\TargetStatisticsStore::BUDGET_BYTES);
    try {$store->ingest(999998,$policy['version'],(string)Illuminate\Support\Str::uuid(),'budget',$prepared,0,100);$assert(false,'Budget rejection');}
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===429,'Global cache budget enforced');}
    $assert($store->report(999998,$policy['version'])['rows']===[],'Budget rejects without partial rows');
    $store->connection()->setex($prefix.'used',7200,$used);
    $capRows=[];
    for($i=0;$i<501;$i++) $capRows[]=['key'=>hash('sha256','cap-'.$i),'meta'=>json_encode(['userId'=>1,'type'=>'domain','target'=>'cap'.$i.'.test']),'connections'=>1,'uploadBytes'=>1,'downloadBytes'=>1];
    $store->ingest(999995,$policy['version'],(string)Illuminate\Support\Str::uuid(),'cap-a',array_slice($capRows,0,250),0,100);
    $store->ingest(999995,$policy['version'],(string)Illuminate\Support\Str::uuid(),'cap-b',array_slice($capRows,250),0,100);
    $capped=$store->report(999995,$policy['version']);
    $assert(count($capped['rows'])===500 && $capped['dropped']===1,'Bucket admits at most 500 unique rows and records dropped rows');
    $dedup=[];for($i=0;$i<1000;$i++) $dedup['fixture-'.$i]='hash';
    $store->connection()->hmset($prefix.'999994:batches',$dedup);
    $store->connection()->expire($prefix.'999994:batches',60);
    try {$store->ingest(999994,$policy['version'],(string)Illuminate\Support\Str::uuid(),'full',$prepared,0,100);$assert(false,'Dedup capacity rejection');}
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===429,'Dedup capacity rejects without evicting old batch identities');}
    $key='target-ingest:v2:v2box:'.$nodeId;
    Illuminate\Support\Facades\RateLimiter::clear($key);
    for($i=0;$i<30;$i++) Illuminate\Support\Facades\RateLimiter::hit($key,60);
    $limited=$call('POST',$root.'/target-statistics',$batch);
    $assert($limited->getStatusCode()===429 && $limited->headers->has('Retry-After'),'Per-node rate limit includes retry advice');
    $assert($call('POST',$root.'/target-statistics',['records'=>[]],['HTTP_X_NODE_ID'=>(string)($nodeId+1)])->getStatusCode()!==429,'Nodes behind same IP do not share quota');
    Illuminate\Support\Facades\RateLimiter::clear($key);
    if (in_array('--benchmark',$argv,true)) {
        $full=[];$legacy=[];
        for($i=0;$i<500;$i++) {
            $row=['userId'=>1,'type'=>'domain','target'=>'host'.$i.'.example.test','connections'=>1,'uploadBytes'=>100,'downloadBytes'=>200];
            $full[]=['key'=>hash('sha256',(string)$i),'meta'=>json_encode(array_intersect_key($row,array_flip(['userId','type','target']))),'connections'=>1,'uploadBytes'=>100,'downloadBytes'=>200];
            $legacy[hash('sha256',(string)$i)]=$row;
        }
        $legacyState=['buckets'=>array_fill(0,12,['rows'=>$legacy,'dropped'=>0]),'batches'=>array_fill(0,360,['at'=>time(),'hash'=>str_repeat('f',64)])];
        $repo=$store->repository();$repo->put('benchmark-legacy',$legacyState,60);
        $started=microtime(true);
        for($i=0;$i<20;$i++) {$copy=$repo->get('benchmark-legacy');$copy['buckets'][0]['rows'][array_key_first($legacy)]['uploadBytes']++;$repo->put('benchmark-legacy',$copy,60);}
        $legacyMs=(microtime(true)-$started)*1000;
        $started=microtime(true);
        for($i=0;$i<20;$i++) $store->ingest(999996,$policy['version'],(string)Illuminate\Support\Str::uuid(),'bench-'.$i,$full,0,strlen(json_encode($full)));
        $atomicMs=(microtime(true)-$started)*1000;
        echo 'Synthetic Redis 20x500: legacy='.round($legacyMs,1).'ms atomic='.round($atomicMs,1).'ms; legacy state='.strlen(serialize($legacyState)).' bytes; merge payload='.strlen(json_encode($full)).' bytes'."\n";
        $repo->forget('benchmark-legacy');
    }
    $stats->configure(false);
    $assert($store->ingest(999997,$policy['version'],(string)Illuminate\Support\Str::uuid(),'disabled',$prepared,0,100)['accepted']===false,'Atomic Redis gate rejects a writer that loaded policy before disable');
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
    $intervalCall=function($authorization,$body)use($kernel,$adminPath){
        // Only this fixture's array-cache quota; keep parameter checks independent of the 10/minute setting limit.
        Illuminate\Support\Facades\RateLimiter::clear('target-settings:'.sha1('|127.0.0.1'));
        return $kernel->handle(Request::create($adminPath.'/target-statistics/settings','POST',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>$authorization],json_encode($body)));};
    $assert($intervalCall('',['reportIntervalSeconds'=>300])->getStatusCode()===403,'Anonymous cannot change report cadence');
    $user->is_admin=0;$user->save();
    $assert($intervalCall($token,['reportIntervalSeconds'=>300])->getStatusCode()===403,'Ordinary user cannot change report cadence');
    $user->is_admin=1;$user->save();
    $dailyCall=function($authorization,$query='view=daily')use($kernel,$adminPath){return $kernel->handle(Request::create($adminPath.'/target-statistics?'.$query,'GET',[],[],[],['HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>$authorization]));};
    $assert($dailyCall('')->getStatusCode()===403,'Daily history requires administrator authentication');
    $assert($dailyCall($token)->getStatusCode()===200,'Administrator can query daily history while collection disabled');
    $assert($dailyCall($token,'view=daily&userId=1')->getStatusCode()===422,'Daily user filter is explicitly unsupported');
    $assert($dailyCall($token,'view=invalid')->getStatusCode()===422,'Unknown target report view rejected');
    $current=$stats->policy();
    foreach([30,60,120,300] as $seconds) {
        $r=$intervalCall($token,['reportIntervalSeconds'=>$seconds]);
        $settings=json_decode($r->getContent(),true)['data'] ?? [];
        $assert($r->getStatusCode()===200 && ($settings['reportIntervalSeconds']??0)===$seconds,'Supported cadence saved');
        $assert($settings['enabled']===false && $settings['version']===$current['version'] && $settings['leaseSeconds']===120,'Cadence-only update preserves switch, generation and short lease');
    }
    foreach([0,10,45,301,-30,60.5,'invalid',null] as $seconds) { $invalidResponse=$intervalCall($token,['reportIntervalSeconds'=>$seconds]);$assert($invalidResponse->getStatusCode()===422,'Invalid cadence rejected '.json_encode($seconds).': '.$invalidResponse->getStatusCode().' '.$invalidResponse->getContent()); }
    $assert($stats->policy()['reportIntervalSeconds']===300,'Invalid save preserves previous cadence');
    foreach([1,6,12,24] as $hours) {
        $r=$intervalCall($token,['retentionHours'=>$hours]);
        $assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']['retentionHours']===$hours,'Retention-only settings accepted');
    }
    foreach([0,7,30] as $days) {
        while($daily->cleanupPending())$daily->runCleanup();
        $r=$intervalCall($token,['dailyRetentionDays'=>$days]);
        $assert($r->getStatusCode()===200 && json_decode($r->getContent(),true)['data']['dailyRetentionDays']===$days,'Daily retention-only setting accepted');
    }
    $assert($intervalCall($token,['dailyRetentionDays'=>7])->getStatusCode()===200,'Shortening queues durable cleanup');
    $assert($intervalCall($token,['dailyRetentionDays'=>30])->getStatusCode()===409,'Expansion blocked until expiry rewrite completes');
    while($daily->cleanupPending())$daily->runCleanup();
    $assert($intervalCall($token,['dailyRetentionDays'=>30])->getStatusCode()===200,'Expansion allowed after cleanup without restoring expired rows');
    foreach([1,31,-1,null,7.5] as $days)$assert($intervalCall($token,['dailyRetentionDays'=>$days])->getStatusCode()===422,'Invalid daily retention rejected');
    $assert($intervalCall('',['dailyRetentionDays'=>30])->getStatusCode()===403,'Anonymous cannot change daily retention');
    $assert(!array_key_exists('dailyRetentionDays',$stats->nodePolicy()),'Daily retention does not change node wire contract');
    foreach([0,2,25,168,null,6.5] as $hours) $assert($intervalCall($token,['retentionHours'=>$hours])->getStatusCode()===422,'Invalid retention rejected');
    $assert($intervalCall('',['retentionHours'=>6])->getStatusCode()===403,'Anonymous cannot alter retention');
    $stats->configure(null,null,1);

    $assert($intervalCall($token,[])->getStatusCode()===422,'Empty settings update rejected');
    $stats->configure(true);
    $afterToggle=$stats->configure(false);
    $assert($afterToggle['reportIntervalSeconds']===300,'Switch-only updates preserve cadence');
    $restored=$stats->configure(null,60);
    $assert($restored['version']===$afterToggle['version'] && $restored['reportIntervalSeconds']===60,'Interval-only settings supported without replacing generation');
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
    $params=['type'=>'v2box','id'=>$nodeId];
    $assert($credentialCall('issue',$params,'')->getStatusCode()===403,'Anonymous cannot generate credentials');
    $user->is_admin=0;$user->save();
    $assert($credentialCall('issue',$params)->getStatusCode()===403,'Ordinary user cannot generate credentials');
    $user->is_admin=1;$user->save();
    $issued=$credentialCall('issue',$params);
    $assert($issued->getStatusCode()===201,'Administrator generates credential without password');
    $assert(str_contains($issued->headers->get('Cache-Control'),'no-store'),'One-time credential response not cached');
    $publicKeys=$kernel->handle(Request::create($adminPath.'/server/credentials?type=v2box&id='.$nodeId,'GET',[],[],[],['HTTP_AUTHORIZATION'=>$token,'HTTP_ACCEPT'=>'application/json']));
    $assert($publicKeys->getStatusCode()===200 && !str_contains($publicKeys->getContent(),'nk_'),'Later listing never reveals secret');
    try {$credentials::disableLegacy((int)$user->id);$assert(false,'Unconfirmed migration cannot disable legacy');}
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Unconfirmed migration cannot disable legacy');}
    $install=(new App\Services\ServerService())->getAllServers();
    foreach ($install as $server) if ($server['type']==='v2box') $assert(str_starts_with($server['install_command'],'wget --https-only -O install-v2box.sh ') && str_contains($server['install_command'],'&& sh install-v2box.sh --install v1.0.15') && str_contains($server['upgrade_command'],'--install v1.0.15'),'Manual install and upgrade use short wget/script commands');
    $assert(!str_contains(json_encode($install),'node-v10-test-secret'),'Install commands never expose global token');
    $freshSecret=json_decode($issued->getContent(),true)['data']['secret'];
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$freshSecret])->getStatusCode()===200,'Replacement confirmed before global retirement');
    $assert(count($credentials::legacyNodes())===0,'Migration report excludes migrated node');
    $credentials::disableLegacy((int)$user->id);
    $assert(!$credentials::legacyEnabled(),'All confirmed nodes allow global retirement');
    $assert($call('GET',$root.'/users',[],['HTTP_X_NODE_ID'=>'999999999'])->getStatusCode()===401,'Retired global key cannot access new identities');
    config(['v2board.server_api_url'=>'https://panel.example.invalid']);
    $deploymentCall=function($body,$authorization=null)use($kernel,$adminPath,$token){
        Illuminate\Support\Facades\RateLimiter::clear('node-deployment:'.sha1('|127.0.0.1'));
        return $kernel->handle(Request::create($adminPath.'/server/credentials/deployment','POST',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>$authorization??$token],json_encode($body)));
    };
    $deployParams=['type'=>'v2box','id'=>$nodeId];
    $assert($deploymentCall($deployParams,'')->getStatusCode()===403,'Anonymous deployment forbidden');
    $user->is_admin=0;$user->save();$assert($deploymentCall($deployParams)->getStatusCode()===403,'Ordinary user cannot create deployment grants');$user->is_admin=1;$user->save();
    $assert($deploymentCall(array_merge($deployParams,['type'=>'v2node']))->getStatusCode()===422,'Automatic enrollment limited to V2Box');
    $beforeKeys=DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$nodeId)->count();
    $grantResponse=$deploymentCall($deployParams);$grant=json_decode($grantResponse->getContent(),true)['data']??[];
    $assert($grantResponse->getStatusCode()===201,'Deployment command created without password: '.$grantResponse->getStatusCode());
    $assert(str_contains($grantResponse->headers->get('Cache-Control'),'no-store'),'Deployment grant not cached by browsers');
    $assert(!str_contains($grant['command'],'nk_') && !str_contains($grant['command'],'test-admin-credential-password'),'Command carries no long-lived key or admin password');
    $pipes=[];$syntax=proc_open(['bash','-n'],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);fwrite($pipes[0],$grant['command']);fclose($pipes[0]);stream_get_contents($pipes[1]);$parseError=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$assert(proc_close($syntax)===0,'Generated deployment command parses as shell: '.preg_replace('/nd_[a-f0-9]{64}/','[grant]',$parseError));
    $assert(!str_contains($grant['command'],"\r") && !str_contains($grant['command'],"\n"),'Deployment command is a single portable shell line');
    $assert(str_contains($grant['command'],'--api-host') && str_contains($grant['command'],'--node-id '.$nodeId) && str_contains($grant['command'],'--deploy-token') && str_starts_with($grant['command'],'wget -q -O install-v2box.sh ') && !str_contains($grant['command'],'deploy_dir') && !str_contains($grant['command'],'--prompt-api-key'),'Single-line command automatically supplies the one-use grant, not an interactive key prompt');
    $assert(str_contains($grant['command'],'wget -q -O') && !str_contains($grant['command'],'apt-get'),'Copied deployment command stays short; dependencies belong in the script');
    preg_match('/nd_[a-f0-9]{64}/',$grant['command'],$matches);$grantToken=$matches[0]??'';
    $assert(strlen($grantToken)===67,'One-use token format');
    $assert(DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$nodeId)->count()===$beforeKeys,'Creating command does not rotate live credentials');
    $repo=Cache::store('node_deployment');$grantKey='grant:'.hash('sha256',$grantToken);
    $assert(!str_contains(json_encode($repo->get($grantKey)),$grantToken),'Redis stores only grant hash and metadata');
    $redeem=function($grant)use($call,$root){return $call('POST',$root.'/enrollments/redeem',[],['HTTP_AUTHORIZATION'=>'Bearer '.$grant]);};
    $assert($redeem('wrong')->getStatusCode()===401,'Invalid deployment grant rejected');
    $assert($call('POST',$root.'/enrollments/redeem',['nodeId'=>$nodeId+1],['HTTP_AUTHORIZATION'=>'Bearer '.$grantToken])->getStatusCode()===422,'Deployment identity cannot be chosen in request body');
    $assert($call('POST',$root.'/enrollments/redeem?token='.$grantToken,[],['HTTP_AUTHORIZATION'=>''])->getStatusCode()===401,'Query deployment token never accepted');
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$newToken=$m[0];
    $assert($redeem($grantToken)->getStatusCode()===401,'Generating new command invalidates prior command');
    $meta=$repo->get('grant:'.hash('sha256',$newToken));$meta['expires']=time()-1;$repo->put('grant:'.hash('sha256',$newToken),$meta,60);
    $assert($redeem($newToken)->getStatusCode()===401,'Expired deployment grant rejected');
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$newToken=$m[0];
    $user->is_admin=0;$user->save();$assert($redeem($newToken)->getStatusCode()===403,'Demoted administrator invalidates outstanding deployment');$user->is_admin=1;$user->save();
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$staleToken=$m[0];
    $savedPassword=$user->password;$user->password=password_hash('changed-fixture-password',PASSWORD_DEFAULT);$user->save();
    $assert($redeem($staleToken)->getStatusCode()===403,'Administrator password change invalidates outstanding deployment');$user->password=$savedPassword;$user->save();
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$staleToken=$m[0];
    $freshId=json_decode($issued->getContent(),true)['data']['id'];
    DB::table('v2_node_credential')->where('id',$freshId)->update(['expires_at'=>time()+1800]);
    $assert($redeem($staleToken)->getStatusCode()===409,'Credential policy changes invalidate outstanding deployment');
    DB::table('v2_node_credential')->where('id',$freshId)->update(['expires_at'=>null]);
    $child=$node->replicate();$child->name='Deployment child';$child->service_id=$nodeId;$child->save();
    $assert($deploymentCall(array_merge($deployParams,['id'=>(int)$child->id]))->getStatusCode()===422,'Child node cannot issue deployment grant');
    $node->refresh();$node->tls=1;$node->tls_settings=['cert_mode'=>'self','server_name'=>'deployment.example.test'];$node->save();
    $child->tls=0;$child->save();
    $deploymentBinding=DB::table('v2_node_ddns')->insertGetId(['credential_id'=>999999,'node_type'=>'v2box','node_id'=>$nodeId,'domain'=>'deployment.example.test','family'=>'dual','enabled'=>true,'managed'=>true,'published_domain'=>$node->host]);
    // Reporting-only enrollment must not issue a node key or change live addresses/backoff.
    DB::table('v2_node_ddns')->where('id',$deploymentBinding)->update(['report_hash'=>hash('sha256',str_repeat('e',64)),'ipv4'=>'8.8.8.8','ipv4_seen_at'=>time(),'next_run'=>time()+900]);
    $networkBefore=DB::table('v2_node_ddns')->find($deploymentBinding);
    $keysBefore=DB::table('v2_node_credential')->where('node_id',$nodeId)->where('node_type','v2box')->get()->toJson();
    $networkGrant=$deploymentCall($deployParams+['networkOnly'=>true]);
    $assert($networkGrant->getStatusCode()===201,'Network-only command generated');
    $networkCommand=json_decode($networkGrant->getContent(),true)['data']['command'];
    $assert(str_contains($networkCommand,'--network-only') && !str_contains($networkCommand,str_repeat('e',64)),'Network command contains purpose but no long-lived reporting key');
    $assert(DB::table('v2_node_ddns')->find($deploymentBinding)->report_hash===$networkBefore->report_hash,'Generating network command preserves active reporter');
    preg_match('/nd_[a-f0-9]{64}/',$networkCommand,$m);$networkToken=$m[0];
    $networkResult=$redeem($networkToken);$networkData=json_decode($networkResult->getContent(),true)['data']??[];
    $assert($networkResult->getStatusCode()===200 && ($networkData['purpose']??'')==='network' && !isset($networkData['apiKey'],$networkData['deployment']),'Network enrollment returns scoped setup only');
    $assert(!isset($networkData['apiKey']) && !isset($networkData['credentialId']) && !isset($networkData['deployment']),'Network grant cannot obtain node credentials or certificate workflow');
    $assert(DB::table('v2_node_credential')->where('node_id',$nodeId)->where('node_type','v2box')->get()->toJson()===$keysBefore,'Network setup never rotates node credentials');
    $networkAfter=DB::table('v2_node_ddns')->find($deploymentBinding);
    $assert(DB::table('v2_network_server')->find($networkAfter->server_id)->report_hash===hash('sha256',$networkData['networkReport']['token']) && $networkAfter->ipv4===$networkBefore->ipv4 && $networkAfter->ipv4_seen_at===$networkBefore->ipv4_seen_at && $networkAfter->next_run===$networkBefore->next_run,'Network enrollment changes only reporting key and retains current IP/provider backoff');
    $assert($redeem($networkToken)->getStatusCode()===401,'Network grant can only be redeemed once');
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$newToken=$m[0];
    $result=$redeem($newToken);$enrolled=json_decode($result->getContent(),true)['data']??[];
    $assert($result->getStatusCode()===200 && $enrolled['nodeId']===$nodeId && $enrolled['apiHost']==='https://panel.example.invalid','One-use enrollment returns authoritative node identity: '.$result->getStatusCode());
    $assert(str_contains($result->headers->get('Cache-Control'),'no-store'),'Credential enrollment response not cached');
    $assert(($enrolled['networkReport']['family']??'')==='dual' && preg_match('/^[a-f0-9]{64}$/',$enrolled['networkReport']['token']??'') && DB::table('v2_network_server')->find($enrolled['networkReport']['serverId'])->report_hash===hash('sha256',$enrolled['networkReport']['token']),'Enrollment configures scoped address reporting without Cloudflare secret');
    $workflow=$enrolled['deployment']['token']??'';
    $progress=fn($action,$bearer=null)=>$call('POST',$root.'/enrollments/progress',['action'=>$action],['HTTP_AUTHORIZATION'=>'Bearer '.($bearer??$workflow)]);
    $assert(preg_match('/^dp_[a-f0-9]{64}$/',$workflow),'Managed deployment receives scoped completion token');
    $assert($progress('status','invalid')->getStatusCode()===401 && $progress('status',$enrolled['apiKey'])->getStatusCode()===401,'Progress rejects wrong credential types');
    $assert($progress('delete')->getStatusCode()===422,'Workflow cannot perform unrelated administration');
    $assert($progress('start')->getStatusCode()===409 && $progress('complete')->getStatusCode()===409,'Unresolved DNS cannot start or publish');
    $observed=$call('POST',$root.'/enrollments/progress',['action'=>'status','dnsState'=>'unavailable','dnsRole'=>'origin'],['HTTP_AUTHORIZATION'=>'Bearer '.$workflow]);
    $assert($observed->getStatusCode()===200 && Cache::get('NODE_DEPLOY_DNS:'.$nodeId)['state']==='unavailable','Authorized installer reports DNS outage for admin visibility');
    $assert($call('POST',$root.'/enrollments/progress',['action'=>'status','dnsState'=>'arbitrary','dnsRole'=>'origin'],['HTTP_AUTHORIZATION'=>'Bearer '.$workflow])->getStatusCode()===422,'DNS observation is an enum, not arbitrary log text');
    $assert($call('POST',$root.'/enrollments/progress',['action'=>'start','dnsState'=>'verified','dnsRole'=>'origin'],['HTTP_AUTHORIZATION'=>'Bearer '.$workflow])->getStatusCode()===409,'Installer observation cannot bypass server readiness');
    $user->is_admin=0;$user->save();$assert($progress('status')->getStatusCode()===403,'Demotion revokes deployment workflow');$user->is_admin=1;$user->save();
    $originalPort=$node->server_port;$node->server_port=8443;$node->save();$assert($progress('status')->getStatusCode()===409,'Node configuration changes invalidate workflow');$node->server_port=$originalPort;$node->save();
    $waiting=json_decode($progress('status')->getContent(),true)['data'];
    $assert($waiting['dnsChecks'][0]['missingFamilies']===['ipv6'] && $waiting['dnsChecks'][0]['role']==='origin','Deployment identifies missing IPv6 and origin separately');
    DB::table('v2_ddns_credential')->insert(['id'=>999999,'name'=>'Deployment fixture','zone_id'=>str_repeat('a',32),'root_domain'=>'example.test','secret'=>Illuminate\Support\Facades\Crypt::encryptString('fixture-only'),'status'=>'ready','next_run'=>0]);
    DB::table('v2_node_ddns')->where('id',$deploymentBinding)->update(['next_run'=>0,'ipv6'=>'2606:4700:4700::1111','ipv6_seen_at'=>time()]);
    Illuminate\Support\Facades\Http::fake(['api.cloudflare.com/*'=>function($request) {
        if ($request->method()==='GET') return Illuminate\Support\Facades\Http::response(['success'=>true,'result'=>[]]);
        return Illuminate\Support\Facades\Http::response(['success'=>true,'result'=>array_merge($request->data(),['id'=>bin2hex(random_bytes(16))])]);
    }]);
    $synchronized=json_decode($progress('status')->getContent(),true)['data'];
    $assert($synchronized['dnsReady'] && $synchronized['dnsChecks'][0]['reason']==='ready','Authorized deployment synchronizes DNS without scheduler');
    $assert(DB::table('v2_node_ddns')->find($deploymentBinding)->last_success>=time()-5,'Deployment sync persists state visible to administration');
    $requests=Illuminate\Support\Facades\Http::recorded()->count();$progress('status');
    $assert(Illuminate\Support\Facades\Http::recorded()->count()===$requests,'Progress polling preserves DNS cooldown');
    DB::table('v2_node_ddns')->where('id',$deploymentBinding)->update(['next_run'=>0,'last_success'=>0]);
    DB::table('v2_ddns_credential')->where('id',999999)->update(['next_run'=>time()+900]);
    $paused=json_decode($progress('status')->getContent(),true)['data'];
    $assert($paused['dnsChecks'][0]['reason']==='provider_backoff' && Illuminate\Support\Facades\Http::recorded()->count()===$requests,'Deployment cannot bypass provider backoff');
    DB::table('v2_ddns_credential')->where('id',999999)->update(['next_run'=>-1]);
    $paused=json_decode($progress('status')->getContent(),true)['data'];
    $assert($paused['dnsChecks'][0]['reason']==='sync_blocked' && Illuminate\Support\Facades\Http::recorded()->count()===$requests,'Deployment explains credential pause without retrying provider');
    DB::table('v2_node_dns_record')->where('assignment_id',$deploymentBinding)->delete();
    DB::table('v2_ddns_credential')->where('id',999999)->delete();
    DB::table('v2_node_ddns')->where('id',$deploymentBinding)->update(['status'=>'ready_to_switch','last_success'=>time(),'ipv4'=>'8.8.8.8','ipv6'=>'2606:4700:4700::1111','ipv4_seen_at'=>time(),'ipv6_seen_at'=>time()]);
    foreach(['A'=>'8.8.8.8','AAAA'=>'2606:4700:4700::1111'] as $kind=>$ip) DB::table('v2_node_dns_record')->insert(['assignment_id'=>$deploymentBinding,'credential_id'=>999999,'domain'=>'deployment.example.test','type'=>$kind,'record_id'=>bin2hex(random_bytes(16)),'owner'=>bin2hex(random_bytes(24)),'content'=>$ip,'status'=>'active']);
    $assert($progress('start')->getStatusCode()===200,'Ready DNS permits one start boundary');
    $assert($progress('complete')->getStatusCode()===409,'DNS alone never publishes without applied receipt');
    $assert($call('GET',$root.'/configuration',[],['HTTP_AUTHORIZATION'=>'Bearer '.$enrolled['apiKey']])->getStatusCode()===200,'New node retrieves authoritative configuration');
    $fetch=Cache::get('NODE_CONFIG_FETCH:v2box:'.$nodeId);
    App\Services\NodeRuntimeService::receipt($nodeId,['hash'=>$fetch['hash'],'state'=>'failed','errorCode'=>'certificate']);
    $assert(json_decode($progress('status')->getContent(),true)['data']['errorCode']==='certificate' && $progress('complete')->getStatusCode()===409,'Certificate failure cannot publish domain');
    App\Services\NodeRuntimeService::receipt($nodeId,['hash'=>$fetch['hash'],'state'=>'applied']);
    $assert($progress('complete')->getStatusCode()===409,'TLS deployment cannot publish without verified certificate fingerprint');
    App\Services\NodeRuntimeService::receipt($nodeId,['hash'=>$fetch['hash'],'state'=>'applied','certificateFingerprint'=>str_repeat('d',64)]);
    $done=$progress('complete');
    $assert($done->getStatusCode()===200 && $node->fresh()->host==='deployment.example.test','Fresh applied receipt activates only enrolled binding');
    $assert(json_decode($progress('complete')->getContent(),true)['data']['completed']===true,'Completion remains idempotent after lost response');
    $workflowKey='workflow:'.hash('sha256',$workflow);$savedWorkflow=$repo->get($workflowKey);$expiredWorkflow=$savedWorkflow;$expiredWorkflow['expires']=time()-1;$repo->put($workflowKey,$expiredWorkflow,60);
    $assert($progress('status')->getStatusCode()===401,'Expired workflow cannot resume');$repo->put($workflowKey,$savedWorkflow,60);
    DB::table('v2_node_credential')->where('id',$enrolled['credentialId'])->update(['revoked_at'=>time()]);
    $assert($progress('status')->getStatusCode()===403,'Revoking node credential revokes workflow');
    DB::table('v2_node_credential')->where('id',$enrolled['credentialId'])->update(['revoked_at'=>null]);
    $assert($redeem($newToken)->getStatusCode()===401,'Deployment grant cannot be replayed');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$enrolled['apiKey']])->getStatusCode()===200,'Redeemed credential authenticates only its node');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$enrolled['apiKey'],'HTTP_X_NODE_ID'=>(string)($nodeId+1)])->getStatusCode()===403,'Redeemed credential cannot access another node');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$newToken])->getStatusCode()===401,'Deployment token never authenticates machine endpoints');
    $assert($deploymentCall($deployParams)->getStatusCode()===409,'Deployment refuses unfinished rotation');
    $bootstrap=$call('GET','/api/v10/public/node-deployment/bootstrap',[],['HTTP_AUTHORIZATION'=>'']);
    $assert($bootstrap->getStatusCode()===200 && str_starts_with($bootstrap->getContent(),'#!/bin/sh') && str_contains($bootstrap->getContent(),'ca-certificates curl bash jq unzip coreutils') && !str_contains($bootstrap->getContent(),'__NODE_PREREQUISITES__') && str_contains($bootstrap->getContent(),'--install'),'Public bootstrap is static shell, no credentials');
    foreach([0,2] as $inactiveTls){
        $inactive=clone $node->fresh();$inactive->tls=$inactiveTls;
        $inactive->tls_settings=['cert_mode'=>'http','server_name'=>'old.invalid','dns_credential_id'=>999999999];
        App\Services\NodeDeploymentWorkflow::validate($inactive);
        $metadata=App\Services\NodeDeploymentWorkflow::issue($inactive,(string)$enrolled['credentialId'],['actor'=>$user->id,'actorProof'=>hash('sha256',(string)$user->password)])['deployment'];
        $assert($metadata['tls']===$inactiveTls && $metadata['certificateMode']==='' && $metadata['certificateDomain']==='' && $metadata['certificateFile']==='','Non-TLS and Reality deployment ignore leftover certificate fields and inactive credentials');
        $repo->forget('workflow:'.hash('sha256',$metadata['token']));
    }
    // Address changes affect newly generated commands, never existing credentials or reports.
    $existingNodeBefore=$node->fresh()->getAttributes();
    $existingCredentialsBefore=DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$nodeId)->orderBy('id')->get()->toJson();
    $existingReportsBefore=DB::table('v2_node_ddns')->orderBy('id')->get()->toJson();
    $existingServersBefore=DB::table('v2_network_server')->orderBy('id')->get()->toJson();
    $addressNode=$node->replicate();$addressNode->name='API address change fixture';$addressNode->tls=0;$addressNode->tls_settings=[];$addressNode->service_id=null;$addressNode->save();
    $oldHost=App\Services\NodeDeployment::host();
    $oldAddressGrant=App\Services\NodeDeployment::create((int)$addressNode->id,(int)$user->id);
    preg_match('/nd_[a-f0-9]{64}/',$oldAddressGrant['command'],$oldAddressToken);
    config(['v2board.server_api_url'=>'https://new-node-api.example.test:8443/']);
    $addressRedeem=fn($secret)=>$call('POST',$root.'/enrollments/redeem',[],['HTTP_AUTHORIZATION'=>'Bearer '.$secret,'HTTP_X_NODE_ID'=>(string)$addressNode->id,'HTTP_X_DEPLOYMENT_CAPABILITIES'=>'runtime-ready-v1']);
    $assert($addressRedeem($oldAddressToken[0])->getStatusCode()===409,'Changing API address rejects stale deployment authorization without rotating credentials');
    $newAddressGrant=App\Services\NodeDeployment::create((int)$addressNode->id,(int)$user->id);
    $assert(str_contains($newAddressGrant['command'],"'https://new-node-api.example.test:8443/api/v10/public/node-deployment/bootstrap'") && str_contains($newAddressGrant['command'],"--api-host 'https://new-node-api.example.test:8443'") && !str_contains($newAddressGrant['command'],$oldHost),'Regenerated one-click command uses only the updated API address');
    preg_match('/nd_[a-f0-9]{64}/',$newAddressGrant['command'],$newAddressToken);
    $addressResponse=$addressRedeem($newAddressToken[0]);$addressData=json_decode($addressResponse->getContent(),true)['data']??[];
    $assert($addressResponse->getStatusCode()===200 && ($addressData['apiHost']??'')==='https://new-node-api.example.test:8443','New address deployment authorization redeems successfully with the updated API host');
    $assert(($addressData['deployment']['accessMode']??'')==='unmanaged','Capable bootstrap receives runtime readiness verification without managed DNS');
    $runtimeGrant=['actor'=>$user->id,'actorProof'=>hash('sha256',(string)$user->password)];
    $assert(App\Services\NodeDeploymentWorkflow::issue($addressNode,$addressData['credentialId'],$runtimeGrant)===[],'Legacy bootstrap retains its unmanaged enrollment response');
    $runtimeProgress=fn($action)=>$call('POST',$root.'/enrollments/progress',['action'=>$action],['HTTP_AUTHORIZATION'=>'Bearer '.$addressData['deployment']['token']]);
    $runtimeState=json_decode($runtimeProgress('status')->getContent(),true)['data'];
    $assert($runtimeState['dnsReady'] && $runtimeState['dnsChecks']===[] && !$runtimeState['completed'],'Runtime-only verification requires no DNS provider or public DNS check');
    $runtimeDns=$call('POST',$root.'/enrollments/progress',['action'=>'status','dnsState'=>'verified','dnsRole'=>'origin'],['HTTP_AUTHORIZATION'=>'Bearer '.$addressData['deployment']['token']]);
    $assert($runtimeDns->getStatusCode()===422,'Runtime-only deployment cannot write managed DNS verification state');
    $assert($runtimeProgress('start')->getStatusCode()===200 && $runtimeProgress('complete')->getStatusCode()===409,'Runtime deployment cannot complete before a fresh applied receipt');
    $assert($node->fresh()->getAttributes()===$existingNodeBefore && DB::table('v2_node_credential')->where('node_type','v2box')->where('node_id',$nodeId)->orderBy('id')->get()->toJson()===$existingCredentialsBefore,'Address change and new deployment preserve existing node configuration, certificate and credentials');
    $assert(DB::table('v2_node_ddns')->orderBy('id')->get()->toJson()===$existingReportsBefore && DB::table('v2_network_server')->orderBy('id')->get()->toJson()===$existingServersBefore,'Address change and new deployment preserve IP report bindings, tokens and server state');
    $addressHeaders=['HTTP_AUTHORIZATION'=>'Bearer '.$addressData['apiKey'],'HTTP_X_NODE_ID'=>(string)$addressNode->id];
    $addressConfiguration=json_decode($call('GET',$root.'/configuration',[],$addressHeaders)->getContent(),true);
    $addressReceipt=['coreVersion'=>'test','features'=>['configuration-receipt-v1'],'configuration'=>['hash'=>$addressConfiguration['meta']['configurationHash'],'state'=>'applied']];
    $call('POST',$root.'/capabilities',$addressReceipt,$addressHeaders);
    $assert($runtimeProgress('complete')->getStatusCode()===200,'Unmanaged deployment completes after real node configuration acknowledgement');
    foreach([$adminPath.'/server/credentials/migrate-api',$adminPath.'/server/network/migrate-api','/api/v10/server/api-migrations/progress'] as $retiredMigration) {
        $assert($call('POST',$retiredMigration,[],['HTTP_AUTHORIZATION'=>$token])->getStatusCode()===404,'Removed API migration endpoints remain unavailable');
    }
    // The deletion marker must revoke authority even if imported data has stale flags/password.
    $deletedNode=$addressNode->replicate();$deletedNode->name='Deleted actor deployment fixture';$deletedNode->save();
    $deletedServer=DB::table('v2_network_server')->where('enabled',true)->whereNotNull('report_hash')->first();
    foreach(['node','network','server'] as $purpose){
        $deletedActor=App\Models\User::create(['email'=>'deleted-deploy-'.$purpose.'@example.test','password'=>password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>1]);
        $revokedGrant=$purpose==='server'?App\Services\NodeDeployment::createServer((int)$deletedServer->id,(int)$deletedActor->id):App\Services\NodeDeployment::create($purpose==='node'?(int)$deletedNode->id:$nodeId,(int)$deletedActor->id,$purpose==='network');
        preg_match('/(?:nd|ns)_[a-f0-9]{64}/',$revokedGrant['command'],$revokedToken);
        $beforeRevokedKeys=DB::table('v2_node_credential')->orderBy('id')->get()->toJson();
        $beforeRevokedReports=DB::table('v2_network_server')->orderBy('id')->get()->toJson();
        DB::table('v2_user')->where('id',$deletedActor->id)->update(['account_deleted_at'=>time()]);
        $rejected=$redeem($revokedToken[0]);
        $assert($rejected->getStatusCode()===403,'Deletion marker revokes '.$purpose.' deployment authority even with stale account flags');
        $assert(DB::table('v2_node_credential')->orderBy('id')->get()->toJson()===$beforeRevokedKeys && DB::table('v2_network_server')->orderBy('id')->get()->toJson()===$beforeRevokedReports,'Deleted actor redemption cannot rotate node or IP reporting keys');
    }
    $auth->removeAllSession();
    echo "PASS: $checks V10 node checks\n";
} finally {
    $store=app(App\Services\TargetStatisticsStore::class);
    // Unique fixture namespace only; never flush a shared Redis database.
    $store->connection()->eval("local keys=redis.call('KEYS',KEYS[1]..'*'); for _,k in ipairs(keys) do redis.call('DEL',k) end; return #keys",1,$targetPrefix);
    DB::rollBack();
}
