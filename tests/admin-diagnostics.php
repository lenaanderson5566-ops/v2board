<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local only');
use App\Services\NodeRuntimeService;
use App\Services\SystemHealthService;
use App\Services\Actions\NodeConfiguration;
use App\Models\ServerV2node;
use Illuminate\Support\Facades\Cache;
$checks = 0;
$assert = function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Diagnostics check failed #' . ($checks + 1)); $checks++; };
$id = 2147483646;
$key = "NODE_CONFIG_FETCH:v2node:{$id}";
$heartbeat = App\Utils\CacheKey::get('SERVER_V2NODE_LAST_CHECK_AT', $id);
try {
    $node = new ServerV2node(['id' => $id, 'protocol' => 'vless', 'server_port' => 443, 'route_id' => []]);
    $node->id = $id;
    $assert(NodeRuntimeService::connection(null, null, false) === 'unknown');
    $assert(NodeRuntimeService::connection(time() - 400, time() - 400, false) === 'offline');
    $assert(NodeRuntimeService::connection(null, time(), false) === 'online');
    $assert(NodeRuntimeService::connection(time(), null, true) === 'limited');
    $assert(NodeRuntimeService::connection(time() - 400, null, true) === 'offline');
    $servers = Mockery::mock(App\Services\ServerService::class)->makePartial();
    $servers->shouldReceive('getAllV2node')->withNoArgs()->andReturn([
        ['id' => $id, 'type' => 'v2node', 'parent_id' => null, 'sort' => 0],
    ]);
    $servers->shouldReceive('getAllV2node')->with('v2box')->andReturn([]);
    Cache::forget($heartbeat);
    $assert($servers->getAllServers()[0]['runtime_status'] === 'unknown');
    Cache::put($heartbeat, time(), 3600);
    $assert($servers->getAllServers()[0]['runtime_status'] === 'online');
    Cache::put($heartbeat, time() - 400, 3600);
    $assert($servers->getAllServers()[0]['runtime_status'] === 'offline');
    $assert(NodeRuntimeService::inspect('v2node', $node)['configurationState'] === 'unknown');
    NodeRuntimeService::record('v2node', $id, NodeConfiguration::build($node), 'v2');
    $state = NodeRuntimeService::inspect('v2node', $node);
    $assert($state['configurationState'] === 'provided' && $state['applicationState'] === 'unconfirmed');
    $assert(count(Cache::get($key)) === 4 && !isset($state['hash']));
    $node->server_port = 8443;
    $assert(NodeRuntimeService::inspect('v2node', $node)['configurationState'] === 'pending');
    NodeRuntimeService::record('v2node', $id, NodeConfiguration::build($node), 'v2');
    $assert(NodeRuntimeService::inspect('v2node', $node)['configurationState'] === 'provided');
    $health = (new SystemHealthService())->inspect();
    $assert(count($health['checks']) === 6);
    $assert(collect($health['checks'])->firstWhere('key', 'database')['status'] === 'healthy');
    $assert(collect($health['checks'])->firstWhere('key', 'redis')['status'] === 'healthy');
    $mock = Mockery::mock(Laravel\Horizon\Contracts\MasterSupervisorRepository::class);
    $mock->shouldReceive('all')->once()->andThrow(new RuntimeException('secret-connection-string'));
    app()->instance(Laravel\Horizon\Contracts\MasterSupervisorRepository::class, $mock);
    $health = (new SystemHealthService())->inspect();
    $assert(collect($health['checks'])->firstWhere('key', 'queue')['status'] === 'error');
    $assert(count($health['checks']) === 6 && !str_contains(json_encode($health), 'secret-connection-string'));
    $settings=app(App\Services\ObservabilitySettings::class);
    $monitor=new App\Services\ObservabilityMonitor();
    $condition=['test'=>['label'=>'Test','message'=>'Failure','severity'=>'critical']];
    $state=$monitor::advance([],$condition,1000);
    $assert($state['test']['state']==='pending');
    $state=$monitor::advance($state,$condition,1001);
    $assert($state['test']['streak']===1);
    $state=$monitor::advance($state,$condition,1060);
    $assert($state['test']['state']==='firing');
    $state=$monitor::advance($state,[],1120);
    $assert($state['test']['state']==='firing');
    $state=$monitor::advance($state,[],1180);
    $assert($state['test']['state']==='resolved' && $state['test']['resolvedAt']===1180);
    $state=$monitor::advance($state,$condition,1240);
    $assert($state['test']['state']==='pending' && $state['test']['resolvedAt']===null);
    $state=$monitor::advance($state,$condition,1500);
    $assert($state['test']['state']==='pending');
    Illuminate\Support\Facades\DB::beginTransaction();
    try {
        $settings->save(App\Services\ObservabilitySettings::DEFAULTS);
        $maintenance=App\Services\NodeMaintenance::class;
        $maintenance::save('v2node',$id,['enabled'=>true,'reason'=>'Test maintenance','endsAt'=>time()+3600,'hideSubscription'=>true]);
        $policies=$maintenance::active();
        $assert($maintenance::hidden($policies,'v2node',$id,null));
        $assert($maintenance::hidden($policies,'v2node',$id-1,$id));
        $assert(!$maintenance::hidden($policies,'v2box',$id,null));
        $assert($servers->getAllServers()[0]['maintenance']['reason']==='Test maintenance');
        $assert($servers->getAllServers()[0]['issues']===[]);
        $assert(NodeRuntimeService::alertConditions($servers->getAllServers())===[]);
        Illuminate\Support\Facades\DB::table('v2_node_maintenance')->where('node_id',$id)->update(['ends_at'=>time()-1]);
        $assert(!$maintenance::hidden($maintenance::active(),'v2node',$id,null));
        Cache::put($heartbeat,time()-400,3600);
        $assert(isset(NodeRuntimeService::alertConditions($servers->getAllServers())['nodes:offline']));
        $maintenance::save('v2node',$id,['enabled'=>false]);
        $assert(!Illuminate\Support\Facades\DB::table('v2_node_maintenance')->where('node_id',$id)->exists());
        try {$maintenance::save('v2node',$id,['enabled'=>true,'endsAt'=>time()-1]);$assert(false);}
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422);}

        try {$settings->save(['sample_percent'=>101]);$assert(false);}
        catch (Illuminate\Validation\ValidationException $e) {$assert(true);}
        try {$settings->save(['unknown'=>1]);$assert(false);}
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422);}
        $performance=new App\Services\RequestPerformance();
        $query=['count'=>2,'ms'=>450,'slow'=>1,'max'=>400];
        $performance->record('GET api/test/{id}',500,2500,$query,2000,6000);
        $performance->record('GET api/test/{id}',200,100,$query,2000,6000);
        $report=$performance->summary(6000);
        $assert($report['total']['samples']===2 && $report['total']['errorPercent']===50.0);
        $assert($report['total']['p95UpperMs']===5000 && $report['total']['averageMs']===1300.0);
        $assert($report['total']['slowQueries']===2 && $report['total']['slowRequests']===1);
        $assert($performance->summary(6960)['total']['samples']===0);
        $settings->save(['sample_percent'=>0]);
        $assert($performance->summary(6000)['total']['samples']===0);
        $snapshot=['health'=>['checks'=>[]],'queue'=>['available'=>true,'items'=>[['length'=>101,'wait'=>1]],'failedJobs'=>1]];
        $conditions=$monitor::conditions($snapshot,$report,$settings->get());
        $assert(isset($conditions['queue:backlog'],$conditions['queue:failed']) && !isset($conditions['requests:errors']));
        $settings->save(['min_samples'=>5]);
        for($i=0;$i<5;$i++) $performance->record('GET api/test/{id}',500,2500,$query,2000,6000);
        $conditions=$monitor::conditions($snapshot,$performance->summary(6000),$settings->get());
        $assert(isset($conditions['requests:errors'],$conditions['requests:slow'],$conditions['queries:slow']));
        $settings->save(['sample_percent'=>100]);
        $collector=app(App\Services\RequestPerformance::class);
        $collector->begin(true);
        Illuminate\Support\Facades\DB::select('SELECT 1 AS private_value');
        $request=Illuminate\Http\Request::create('/api/secret-token?password=secret-value');
        $request->setRouteResolver(fn()=>new Illuminate\Routing\Route(['GET'],'api/{token}',fn()=>null));
        $collector->finish($request,200);
        $captured=$collector->summary();
        $assert($captured['total']['queries']===1 && $captured['total']['samples']===1);
        $assert(!str_contains(json_encode($captured),'secret') && !str_contains(json_encode($captured),'private_value'));
        $collector->begin(false);$collector->finish($request,500);
        $assert($collector->summary()['total']['samples']===1);
        for($i=0;$i<140;$i++) $collector->record('GET route'.$i,200,100,$query,2000,12000);
        $bounded=$collector->summary(12000);
        $assert($bounded['total']['samples']===140 && count($bounded['routes'])===50);
        $originalCache=Cache::getFacadeRoot();
        try {
            Cache::swap(Mockery::mock()->shouldReceive('lock')->andThrow(new RuntimeException('cache unavailable'))->getMock());
            $collector->record('GET failure',500,100,$query,2000);
            $assert(true);
        } finally {Cache::swap($originalCache);}
        $settings->save(['sample_percent'=>100,'min_samples'=>10000]);
        $middleware=new App\Http\Middleware\ObservePerformance();
        try {$middleware->handle($request,fn()=>throw new Illuminate\Auth\AuthenticationException());$assert(false);}
        catch (Illuminate\Auth\AuthenticationException $e) {$assert($collector->summary()['total']['errors']===0);}
        $healthMock=Mockery::mock(SystemHealthService::class);
        $healthMock->shouldReceive('inspect')->twice()->andReturn(['checks'=>[['key'=>'database','label'=>'Database','message'=>'Unavailable','status'=>'error']]]);
        app()->instance(SystemHealthService::class,$healthMock);
        $workload=Mockery::mock(Laravel\Horizon\Contracts\WorkloadRepository::class);
        $workload->shouldReceive('get')->twice()->andReturn([]);
        app()->instance(Laravel\Horizon\Contracts\WorkloadRepository::class,$workload);
        $jobs=Mockery::mock(Laravel\Horizon\Contracts\JobRepository::class);
        $jobs->shouldReceive('countRecentlyFailed')->twice()->andReturn(0);
        app()->instance(Laravel\Horizon\Contracts\JobRepository::class,$jobs);
        $monitor->inspect();
        $assert($monitor->report()['stale']===false && $monitor->report()['alerts'][0]['state']==='pending');
        $nodeCondition=['nodes:offline'=>['label'=>'节点通信中断','message'=>'test','severity'=>'critical']];
        $prior=$monitor::advance([],$nodeCondition,time()-120);
        $prior=$monitor::advance($prior,$nodeCondition,time()-60);
        Cache::put($monitor::ALERTS,$prior,600);
        $nodeProbe=Mockery::mock(App\Services\ServerService::class);
        $nodeProbe->shouldReceive('getAllServers')->once()->andThrow(new RuntimeException('private backend error'));
        app()->instance(App\Services\ServerService::class,$nodeProbe);
        $failedProbe=$monitor->inspect();
        $assert(collect($failedProbe['alerts'])->firstWhere('key','nodes:offline')['state']==='firing');
        $assert(collect($failedProbe['alerts'])->firstWhere('key','nodes:probe')!==null && !str_contains(json_encode($failedProbe),'private backend error'));
        app()->forgetInstance(App\Services\ServerService::class);
        Cache::put(App\Services\ObservabilityMonitor::SNAPSHOT,['checkedAt'=>time()-181],600);
        $assert($monitor->report()['stale']===true);
        $admin=App\Models\User::create(['email'=>'monitor-test@example.test','password'=>password_hash('test-only',PASSWORD_DEFAULT),'is_admin'=>1,'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
        $auth=new App\Services\AuthService($admin);
        $token=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
        $kernel=app(Illuminate\Contracts\Http\Kernel::class);
        $prefix='/api/v1/'.config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
        $call=function($method,$suffix,$body=[],$authorized=true) use($kernel,$prefix,$token) {
            $request=Illuminate\Http\Request::create($prefix.'/system/observability'.$suffix,$method,[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json'],json_encode($body));
            if ($authorized) $request->headers->set('Authorization',$token);
            return $kernel->handle($request);
        };
        $assert($call('GET','',[],false)->getStatusCode()===403);
        $assert($call('GET','')->getStatusCode()===200);
        $assert($call('POST','/settings',['sample_percent'=>101])->getStatusCode()===422);
        $assert($call('POST','/settings',['sample_percent'=>10])->getStatusCode()===200);
        $admin->update(['is_admin'=>0]);
        $assert($call('POST','/settings',['sample_percent'=>100])->getStatusCode()===403);
        $auth->removeAllSession();

    } finally {
        Illuminate\Support\Facades\DB::rollBack();Cache::forget('observability:settings:v1');
        app()->forgetInstance(App\Services\ObservabilitySettings::class);
    }
    echo "Administrator diagnostics: {$checks} checks passed\n";
} finally {
    Cache::forget(App\Services\ObservabilityMonitor::SNAPSHOT);
    Cache::forget(App\Services\ObservabilityMonitor::ALERTS);
    Cache::forget($key);
    Cache::forget($heartbeat);
    Mockery::close();
}
