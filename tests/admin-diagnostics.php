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
    $assert(count(Cache::get($key)) === 3 && !isset($state['hash']));
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
    echo "Administrator diagnostics: {$checks} checks passed\n";
} finally {
    Cache::forget($key);
    Cache::forget($heartbeat);
    Mockery::close();
}
