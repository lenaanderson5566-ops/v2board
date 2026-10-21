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
    $current=$stats->policy();
    foreach([30,60,120,300] as $seconds) {
        $r=$intervalCall($token,['reportIntervalSeconds'=>$seconds]);
        $settings=json_decode($r->getContent(),true)['data'] ?? [];
        $assert($r->getStatusCode()===200 && ($settings['reportIntervalSeconds']??0)===$seconds,'Supported cadence saved');
        $assert($settings['enabled']===false && $settings['version']===$current['version'] && $settings['leaseSeconds']===120,'Cadence-only update preserves switch, generation and short lease');
    }
    foreach([0,10,45,301,-30,60.5,'invalid',null] as $seconds) { $invalidResponse=$intervalCall($token,['reportIntervalSeconds'=>$seconds]);$assert($invalidResponse->getStatusCode()===422,'Invalid cadence rejected '.json_encode($seconds).': '.$invalidResponse->getStatusCode().' '.$invalidResponse->getContent()); }
    $assert($stats->policy()['reportIntervalSeconds']===300,'Invalid save preserves previous cadence');
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
    foreach ($install as $server) if ($server['type']==='v2box') $assert(str_starts_with($server['install_command'],'wget --https-only -O install-v2box.sh ') && str_contains($server['install_command'],'&& sh install-v2box.sh --install v1.0.2') && str_contains($server['upgrade_command'],'--install v1.0.2'),'Manual install and upgrade use short wget/script commands');
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
    $child=$node->replicate();$child->name='Deployment child';$child->parent_id=$nodeId;$child->save();
    $assert($deploymentCall(array_merge($deployParams,['id'=>(int)$child->id]))->getStatusCode()===422,'Child node cannot issue deployment grant');
    $newGrant=$deploymentCall($deployParams);preg_match('/nd_[a-f0-9]{64}/',json_decode($newGrant->getContent(),true)['data']['command'],$m);$newToken=$m[0];
    $result=$redeem($newToken);$enrolled=json_decode($result->getContent(),true)['data']??[];
    $assert($result->getStatusCode()===200 && $enrolled['nodeId']===$nodeId && $enrolled['apiHost']==='https://panel.example.invalid','One-use enrollment returns authoritative node identity: '.$result->getStatusCode());
    $assert(str_contains($result->headers->get('Cache-Control'),'no-store'),'Credential enrollment response not cached');
    $assert($redeem($newToken)->getStatusCode()===401,'Deployment grant cannot be replayed');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$enrolled['apiKey']])->getStatusCode()===200,'Redeemed credential authenticates only its node');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$enrolled['apiKey'],'HTTP_X_NODE_ID'=>(string)($nodeId+1)])->getStatusCode()===403,'Redeemed credential cannot access another node');
    $assert($call('GET',$root.'/users',[],['HTTP_AUTHORIZATION'=>'Bearer '.$newToken])->getStatusCode()===401,'Deployment token never authenticates machine endpoints');
    $assert($deploymentCall($deployParams)->getStatusCode()===409,'Deployment refuses unfinished rotation');
    $bootstrap=$call('GET','/api/v10/public/node-deployment/bootstrap',[],['HTTP_AUTHORIZATION'=>'']);
    $assert($bootstrap->getStatusCode()===200 && str_starts_with($bootstrap->getContent(),'#!/bin/sh') && str_contains($bootstrap->getContent(),'ca-certificates curl bash jq unzip coreutils') && !str_contains($bootstrap->getContent(),'__NODE_PREREQUISITES__') && str_contains($bootstrap->getContent(),'--install'),'Public bootstrap is static shell, no credentials');
    $auth->removeAllSession();
    echo "PASS: $checks V10 node checks\n";
} finally {
    $store=app(App\Services\TargetStatisticsStore::class);
    // Unique fixture namespace only; never flush a shared Redis database.
    $store->connection()->eval("local keys=redis.call('KEYS',KEYS[1]..'*'); for _,k in ipairs(keys) do redis.call('DEL',k) end; return #keys",1,$targetPrefix);
    DB::rollBack();
}
