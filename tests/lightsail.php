<?php

$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) {
    throw new RuntimeException('Local test only');
}
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Http\Request;
use Aws\Lightsail\LightsailClient;
use Aws\Result;
use App\Services\LightsailService;
use App\Http\Controllers\V1\Admin\LightsailController;
set_exception_handler(function ($e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
});
$checks = 0;
$assert = function ($ok, $message) use (&$checks) {
    if (!$ok) {
        throw new RuntimeException($message);
    }
    $checks++;
};
config(['cache.default' => 'array']);
Queue::fake();
DB::beginTransaction();
try {
    (new App\Http\Controllers\V1\Admin\Server\V2boxController())->save(Request::create('/', 'POST', ['name' => 'Cloud test', 'host' => 'example.test', 'port' => '443', 'server_port' => 443, 'protocol' => 'vless', 'network' => 'tcp', 'disable_sni' => 0, 'zero_rtt_handshake' => 0, 'rate' => 1, 'group_id' => [1], 'tls' => 0, 'show' => 1]));
    $node = App\Models\ServerV2box::where('name', 'Cloud test')->orderByDesc('id')->firstOrFail();
    $admin = new LightsailController();
    $config = ['name' => 'AWS test', 'region' => 'ap-southeast-1', 'instance' => 'test-instance', 'node_type' => 'v2box', 'node_id' => $node->id, 'accessKey' => 'test-key', 'secretKey' => 'test-secret'];
    $admin->save(Request::create('/', 'POST', $config));
    $row = DB::table('v2_lightsail_server')->where('node_id', $node->id)->where('node_type', 'v2box')->first();
    $originalCredentials = DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials');
    $assert(!str_contains($originalCredentials, 'test-secret'), 'Secrets encrypted');
    $public = json_decode($admin->fetch()->getContent(), true)['data'];
    $entry = collect($public)->firstWhere('id', $row->id);
    $assert(!isset($entry['credentials']) && !str_contains(json_encode($entry), 'test-secret'), 'No secret in admin response');
    $config['id'] = $row->id;
    unset($config['accessKey'], $config['secretKey']);
    $admin->save(Request::create('/', 'POST', $config));
    $assert(DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials') === $originalCredentials, 'Blank credentials preserved');
    $state = (object) ['ips' => ['old' => ['name' => 'old', 'ipAddress' => '8.8.8.8', 'isAttached' => true, 'attachedTo' => 'test-instance']], 'calls' => [], 'fail' => null, 'timeoutAfterAttach' => false];
    $handler = function ($command, $request) use ($state) {
        $name = $command->getName();
        $state->calls[] = $name;
        if ($state->fail === $name) {
            if (isset($state->awsCode)) {
                $previous = isset($state->curl) ? new GuzzleHttp\Exception\ConnectException('simulated_secret_must_not_be_logged', new GuzzleHttp\Psr7\Request('POST', 'https://example.test'), null, ['errno' => $state->curl]) : null;
                throw new Aws\Exception\AwsException('simulated_secret_must_not_be_logged', $command, ['code' => $state->awsCode, 'message' => $state->awsMessage ?? 'simulated_secret_must_not_be_logged', 'connection_error' => $state->awsCode === 'NetworkError', 'response' => isset($state->http) ? new GuzzleHttp\Psr7\Response($state->http, [], 'simulated_secret_must_not_be_logged') : null], $previous);
            }
            throw new RuntimeException('simulated_secret_must_not_be_logged');
        }
        $ipName = $command['staticIpName'] ?? '';
        switch ($name) {
            case 'GetInstance':
                $result = ['instance' => ['isStaticIp' => true]];
                break;
            case 'GetStaticIps':
                $result = ['staticIps' => array_values($state->ips)];
                break;
            case 'GetStaticIp':
                if (!isset($state->ips[$ipName])) {
                    throw new Aws\Exception\AwsException('not found', $command, ['code' => 'NotFoundException']);
                }
                $result = ['staticIp' => $state->ips[$ipName]];
                break;
            case 'AllocateStaticIp':
                $state->ips[$ipName] = ['name' => $ipName, 'ipAddress' => '1.1.1.1', 'isAttached' => false];
                $result = [];
                break;
            case 'DetachStaticIp':
                $state->ips[$ipName]['isAttached'] = false;
                unset($state->ips[$ipName]['attachedTo']);
                $result = [];
                break;
            case 'AttachStaticIp':
                $state->ips[$ipName]['isAttached'] = true;
                $state->ips[$ipName]['attachedTo'] = $command['instanceName'];
                if ($state->timeoutAfterAttach) {
                    $state->timeoutAfterAttach = false;
                    throw new RuntimeException('timeout');
                }
                $result = [];
                break;
            case 'ReleaseStaticIp':
                if ($state->ips[$ipName]['isAttached']) {
                    throw new RuntimeException('unsafe release');
                }
                unset($state->ips[$ipName]);
                $result = [];
                break;
            default:
                throw new RuntimeException('Unexpected AWS request');
        }
        return GuzzleHttp\Promise\Create::promiseFor(new Result($result));
    };
    $client = new LightsailClient(['version' => 'latest', 'region' => 'ap-southeast-1', 'credentials' => ['key' => 'fake', 'secret' => 'fake'], 'handler' => $handler]);
    $service = new class($client) extends LightsailService
    {
        public function __construct(private LightsailClient $fake)
        {
        }
        public function client($row): LightsailClient
        {
            return $this->fake;
        }
    };
    $start = function (string $new) use ($row) {
        DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued', 'phase' => 'idle', 'operation' => 'rotate', 'new_name' => $new, 'old_name' => null]);
    };
    $start('new');
    $state->fail = 'AllocateStaticIp';
    $service->run($row->id);
    $assert($state->ips['old']['isAttached'] && !in_array('DetachStaticIp', $state->calls, true), 'Allocate failure preserves attached old IP');
    $failed = DB::table('v2_lightsail_server')->find($row->id);
    $assert($failed->status === 'failed' && !str_contains($failed->error_code, 'secret'), 'Safe failure state');
    foreach (['AccessDeniedException', 'ExpiredTokenException', 'ThrottlingException', 'NetworkError', 'InvalidInputException', 'UnrecognizedSensitiveProviderCode'] as $awsCode) {
        $state->awsCode = $awsCode;
        $state->awsMessage = 'Static IP quota limit exceeded simulated_secret_must_not_be_logged';
        $state->calls = [];
        DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued']);
        $service->run($row->id);
        $failed = DB::table('v2_lightsail_server')->find($row->id);
        $expected = $awsCode === 'UnrecognizedSensitiveProviderCode' ? 'UnknownError' : $awsCode;
        $expected = 'aws:allocate:'.$expected.($awsCode === 'InvalidInputException' ? ':quota' : '');
        $assert($failed->error_code === $expected && strlen($expected) <= 50, 'Safe actionable AWS failure '.$awsCode);
        $assert($failed->phase === 'allocate' && $state->ips['old']['isAttached'] && !in_array('DetachStaticIp', $state->calls, true) && !in_array('ReleaseStaticIp', $state->calls, true), 'AWS allocation failure preserves old IP '.$awsCode);
    }
    $state->fail = 'GetStaticIp';
    $state->awsCode = 'AccessDeniedException';
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued']);
    $service->run($row->id);
    $assert(DB::table('v2_lightsail_server')->find($row->id)->error_code === 'aws:get:AccessDeniedException', 'Read permission failure distinguished from allocation');
    foreach ([['http',403,'Http403'], ['http',404,'Http404'], ['http',502,'Http502'], ['curl',60,'Curl60'], ['curl',28,'Curl28'], ['curl',6,'Curl6']] as [$kind,$value,$expected]) {
        $state->awsCode = 'UnrecognizedSensitiveProviderCode';
        $state->{$kind} = $value;
        $state->calls = [];
        DB::table('v2_lightsail_server')->where('id',$row->id)->update(['status'=>'queued']);
        $service->run($row->id);
        $assert(DB::table('v2_lightsail_server')->find($row->id)->error_code === 'aws:get:'.$expected, 'Safe transport diagnostic '.$expected);
        $assert($state->ips['old']['isAttached'] && !in_array('AllocateStaticIp',$state->calls,true) && !in_array('DetachStaticIp',$state->calls,true), 'Unrecognized read failure cannot authorize allocation '.$expected);
        unset($state->{$kind});
    }
    unset($state->awsCode, $state->awsMessage);
    $state->fail = null;
    $state->calls = [];
    $state->timeoutAfterAttach = true;
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued']);
    $service->run($row->id);
    $assert($state->ips['new']['isAttached'] && isset($state->ips['old']), 'Uncertain attach retains old allocated IP');
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued']);
    $state->calls = [];
    $service->run($row->id);
    $assert(DB::table('v2_lightsail_server')->find($row->id)->status === 'completed' && !isset($state->ips['old']), 'Resume verifies attach then releases old IP');
    $assert(!in_array('AllocateStaticIp', $state->calls, true) && !in_array('AttachStaticIp', $state->calls, true), 'Resume does not allocate or attach twice');
    $assert(Cache::get('NODE_CURRENT_IP:v2box:' . $node->id) === '1.1.1.1', 'Current IP updated');
    // Restore after a failed attachment; old IP is still allocated.
    $state->ips = ['old' => ['name' => 'old', 'ipAddress' => '8.8.8.8', 'isAttached' => false], 'new' => ['name' => 'new', 'ipAddress' => '1.1.1.1', 'isAttached' => true, 'attachedTo' => 'test-instance']];
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued', 'phase' => 'attach', 'old_name' => 'old', 'new_name' => 'new', 'operation' => 'restore']);
    $service->run($row->id);
    $assert($state->ips['old']['isAttached'] && !isset($state->ips['new']) && DB::table('v2_lightsail_server')->find($row->id)->status === 'restored', 'Restore reattaches old before cleaning new IP');
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued', 'operation_at' => time()]);
    try {
        $admin->operate(Request::create('/', 'POST', ['id' => $row->id, 'action' => 'resume', 'confirmInstance' => 'test-instance']));
        throw new RuntimeException('Duplicate accepted');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
        $assert($e->getStatusCode() === 409, 'Concurrent submit rejected');
    }
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'ready']);
    try {
        $admin->operate(Request::create('/', 'POST', ['id' => $row->id, 'action' => 'rotate', 'confirmInstance' => 'wrong']));
        throw new RuntimeException('Confirmation bypassed');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
        $assert($e->getStatusCode() === 422, 'Exact instance confirmation required');
    }
    $job = new App\Jobs\RotateLightsailIpJob($row->id);
    $attrs = (new ReflectionClass($job))->getAttributes();
    $assert(count($attrs) === 4, 'Laravel queue attributes configured');
    $assert(config('queue.connections.redis-infrastructure.retry_after') > 180, 'Reservation outlives job timeout');
    $queue = new class(app('redis'), 'infrastructure', 'default', 360) extends Illuminate\Queue\RedisQueue
    {
        public function payload($job)
        {
            return json_decode($this->createPayload($job, 'infrastructure'), true);
        }
    };
    $queue->setContainer($app);
    $payload = $queue->payload($job);
    $assert($payload['maxTries'] === 1 && $payload['timeout'] === 180, 'Laravel 13 attributes control actual queue payload');
    // DNS rejects a previously healthy assignment: do not release the old address.
    $credential = DB::table('v2_ddns_credential')->insertGetId(['name' => 'Cloud test DNS', 'zone_id' => str_repeat('a', 32), 'secret' => Crypt::encryptString('fake'), 'next_run' => 0, 'status' => 'ready']);
    $assignment = DB::table('v2_node_ddns')->insertGetId(['credential_id' => $credential, 'node_type' => 'v2box', 'node_id' => $node->id, 'domain' => 'cloud-test.example.test', 'family' => 'ipv4', 'enabled' => 1, 'ipv4' => '8.8.8.8', 'ipv4_seen_at' => time(), 'status' => 'healthy']);
    \Illuminate\Support\Facades\Http::fake(['api.cloudflare.com/*' => \Illuminate\Support\Facades\Http::response(['success' => false], 403)]);
    $state->ips = ['old' => ['name' => 'old', 'ipAddress' => '8.8.8.8', 'isAttached' => true, 'attachedTo' => 'test-instance']];
    $state->calls = [];
    $start('dns-new');
    $service->run($row->id);
    $failed = DB::table('v2_lightsail_server')->find($row->id);
    $assert($failed->phase === 'publish' && $failed->error_code === 'dns_update_failed' && isset($state->ips['old']), 'DNS failure preserves old allocated IP, including previously healthy assignment');
    $assert(!in_array('ReleaseStaticIp', $state->calls, true), 'No release before successful DNS verification');
    $changed = $config;
    $changed['accessKey'] = 'replacement';
    $changed['secretKey'] = 'replacement-secret';
    $admin->save(Request::create('/', 'POST', $changed));
    $assert(str_contains(Crypt::decryptString(DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials')), 'replacement-secret'), 'Failed operation allows credential repair');
    $changed['instance'] = 'another-instance';
    try {
        $admin->save(Request::create('/', 'POST', $changed));
        throw new RuntimeException('Unsafe retarget accepted');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
        $assert($e->getStatusCode() === 409, 'Failed operation cannot change target');
    }
    DB::table('v2_node_ddns')->where('id', $assignment)->delete();
    $state->ips['old']['isAttached'] = true;
    $state->ips['old']['attachedTo'] = 'unrelated-instance';
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued', 'phase' => 'release']);
    $state->calls = [];
    $service->run($row->id);
    $assert(DB::table('v2_lightsail_server')->find($row->id)->error_code === 'old_ip_in_use' && !in_array('ReleaseStaticIp', $state->calls, true), 'Never release an IP moved to another instance');
    $lock = Cache::lock('lightsail:' . hash('sha256', 'ap-southeast-1:test-instance'), 300);
    $lock->get();
    try {
        $service->run($row->id);
        throw new RuntimeException('Lock bypassed');
    } catch (RuntimeException $e) {
        $assert($e->getMessage() === 'instance_busy', 'Same-instance concurrency is locked');
    } finally {
        $lock->release();
    }
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'queued', 'operation_at' => time() - 400]);
    $public = json_decode($admin->fetch()->getContent(), true)['data'];
    $assert(collect($public)->firstWhere('id', $row->id)['recoverable'] === true, 'Lost queue dispatch can be resumed after bounded waiting');
    $reject = function ($fn, $message) use ($assert) {
        try { $fn(); } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $assert($e->getStatusCode() === 409, $message);
            return;
        }
        throw new RuntimeException($message);
    };
    foreach (['queued', 'running'] as $status) {
        DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => $status]);
        $reject(fn() => $admin->drop(Request::create('/', 'POST', ['id' => $row->id, 'abandonOperation' => true])), 'Active or stalled jobs cannot be removed');
        $reject(fn() => $admin->save(Request::create('/', 'POST', $config + ['abandonOperation' => true])), 'Active jobs cannot be edited or abandoned');
    }
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'failed', 'phase' => 'allocate', 'old_name' => 'old', 'new_name' => 'pending-new', 'current_ip' => '8.8.8.8', 'error_code' => 'aws_request_failed']);
    $public = collect(json_decode($admin->fetch()->getContent(), true)['data'])->firstWhere('id', $row->id);
    $assert($public['staticIpNames'] === ['old', 'pending-new'], 'Failed resources are visible for manual reconciliation');
    $reject(fn() => $admin->drop(Request::create('/', 'POST', ['id' => $row->id])), 'Abandoning a failed operation requires acknowledgement');
    $retarget = array_replace($config, ['instance' => 'replacement-instance', 'abandonOperation' => true]);
    $lock = LightsailService::operationLock(DB::table('v2_lightsail_server')->find($row->id));
    $lock->get();
    try {
        $reject(fn() => $admin->drop(Request::create('/', 'POST', ['id' => $row->id, 'abandonOperation' => true])), 'Removal respects worker lock');
        $reject(fn() => $admin->save(Request::create('/', 'POST', $retarget)), 'Retarget respects worker lock');
    } finally { $lock->release(); }
    $calls = $state->calls;
    $credentials = DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials');
    $admin->save(Request::create('/', 'POST', $retarget));
    $reset = DB::table('v2_lightsail_server')->find($row->id);
    $assert($reset->instance === 'replacement-instance' && $reset->status === 'ready' && $reset->phase === 'idle' && $reset->old_name === null && $reset->new_name === null && $reset->current_ip === null && $reset->error_code === null && (int) $reset->operation_at === 0, 'Acknowledged retarget resets failed operation state');
    $assert(DB::table('v2_lightsail_credential')->where('id',$reset->credential_id)->value('credentials') === $credentials, 'Retarget preserves encrypted credentials when blank');
    $service->run($row->id);
    $assert($state->calls === $calls, 'Abandon and stale job do not change AWS resources');
    DB::table('v2_lightsail_server')->where('id', $row->id)->update(['status' => 'failed', 'phase' => 'attach']);
    $admin->drop(Request::create('/', 'POST', ['id' => $row->id, 'abandonOperation' => true]));
    $service->run($row->id);
    $assert(!DB::table('v2_lightsail_server')->where('id', $row->id)->exists() && $node->fresh() && $state->calls === $calls, 'Failed removal and delayed job preserve node and all AWS resources');
    $other = $node->replicate(); $other->name = 'Second cloud node'; $other->save();
    $base = array_diff_key($config, ['id'=>true]);
    $base['credential_id'] = $row->credential_id;
    $before = DB::table('v2_lightsail_credential')->count();
    $admin->save(Request::create('/', 'POST', array_replace($base, ['instance'=>'first-shared'])));
    $admin->save(Request::create('/', 'POST', array_replace($base, ['node_id'=>$other->id, 'instance'=>'second-shared', 'region'=>'eu-west-2'])));
    $bound = DB::table('v2_lightsail_server')->where('credential_id',$row->credential_id)->get();
    $assert($bound->count()===2 && DB::table('v2_lightsail_credential')->count()===$before, 'One credential binds multiple servers across regions without copying secrets');
    $public = collect(json_decode($admin->credentials()->getContent(),true)['data'])->firstWhere('id',$row->credential_id);
    $assert($public['server_count']===2 && !isset($public['credentials']) && !str_contains(json_encode($public),'replacement-secret'), 'Credential listing exposes usage without secrets');
    $update = ['id'=>$row->credential_id,'name'=>'Shared account','accessKey'=>'rotated-key','secretKey'=>'rotated-secret'];
    $reject(fn()=>$admin->saveCredential(Request::create('/','POST',$update)), 'Shared key update requires explicit acknowledgement');
    $update['confirmSharedUpdate']=true;
    $lock=LightsailService::operationLock($bound[0]); $lock->get();
    try { $reject(fn()=>$admin->saveCredential(Request::create('/','POST',$update)), 'Shared rotation respects an exiting worker lock'); }
    finally { $lock->release(); }
    $admin->saveCredential(Request::create('/','POST',$update));
    foreach($bound as $server) {
        $resolved=(new LightsailService())->client($server)->getCredentials()->wait();
        $assert($resolved->getAccessKeyId()==='rotated-key' && $resolved->getSecretKey()==='rotated-secret','Every bound server resolves the same updated credential');
    }
    $reject(fn()=>$admin->save(Request::create('/','POST',array_replace($base,['id'=>$bound[0]->id,'instance'=>$bound[0]->instance,'accessKey'=>'bypass','secretKey'=>'bypass']))), 'Server edit cannot silently rotate shared credentials');
    DB::table('v2_lightsail_server')->where('id',$bound[0]->id)->update(['status'=>'queued']);
    $reject(fn()=>$admin->saveCredential(Request::create('/','POST',$update)), 'Shared secret rotation is blocked while any bound job is active');
    DB::table('v2_lightsail_server')->where('id',$bound[0]->id)->update(['status'=>'ready']);
    $reject(fn()=>$admin->dropCredential(Request::create('/','POST',['id'=>$row->credential_id])), 'Bound credentials cannot be removed');
    $encrypted=DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials');
    $admin->saveCredential(Request::create('/','POST',['id'=>$row->credential_id,'name'=>'Renamed account']));
    $assert(DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->value('credentials')===$encrypted,'Rename with blank secrets preserves shared encrypted credentials');
    foreach($bound as $server) $admin->drop(Request::create('/','POST',['id'=>$server->id]));
    $assert(DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->exists(),'Removing server bindings preserves reusable credential');
    $admin->dropCredential(Request::create('/','POST',['id'=>$row->credential_id]));
    $assert(!DB::table('v2_lightsail_credential')->where('id',$row->credential_id)->exists(),'Unused credential can be removed separately');
    echo "Lightsail: {$checks} checks passed\n";
} finally {
    DB::rollBack();
}
