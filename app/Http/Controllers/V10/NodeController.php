<?php
namespace App\Http\Controllers\V10;

use App\Http\Controllers\Controller;
use App\Services\ServerService;
use App\Services\Actions\NodeCommunication;
use App\Services\Actions\NodeV10Config;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class NodeController extends Controller {
    public function targetStatisticsPolicy(Request $request) {
        $this->node($request);
        return response()->json(['data'=>app(\App\Services\TargetStatistics::class)->nodePolicy()])->header('Cache-Control','no-store');
    }
    public function targetStatistics(Request $request) {
        $node=$this->node($request);
        $statistics=app(\App\Services\TargetStatistics::class);
        if (!$statistics->policy()['enabled']) return response()->json(['data'=>['accepted'=>false]]);
        $input=$request->validate([
            'version'=>'required|uuid','batchId'=>'required|uuid','dropped'=>'required|integer|min:0|max:1000000000',
            'records'=>'present|array|max:500','records.*.userId'=>'required|integer|min:1',
            'records.*.target'=>'required|string|max:253','records.*.type'=>'required|in:domain,ip',
            'records.*.connections'=>'required|integer|min:0|max:1000000000',
            'records.*.uploadBytes'=>'required|integer|min:0|max:1000000000000000',
            'records.*.downloadBytes'=>'required|integer|min:0|max:1000000000000000',
        ]);
        return response()->json(['data'=>$statistics->receive($node,$input,(int)$request->attributes->get('targetStatisticsBytes',0))]);
    }
    private function node(Request $request) {
        // Only V2Box implements this machine contract today; reject unknown types
        // rather than looking up a colliding ID in the wrong backend table.
        abort_unless($request->header('X-Node-Type') === 'v2box', 422);
        $id = $request->header('X-Node-ID');
        abort_unless(ctype_digit((string) $id) && filter_var($id, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]) !== false, 422);
        $node = (new ServerService())->getServer((int) $id, 'v2box');
        abort_unless($node, 404);
        \App\Services\NodeAddressService::observe($request, 'v2box', (int) $id);
        return $node;
    }
    private function cached(Request $request, array $data, bool $configuration = false) {
        $hash = hash('sha256', json_encode($data));
        $tag = '"'.$hash.'"';
        if ($request->header('If-None-Match') === $tag) return response('', 304)->header('ETag', $tag);
        return response()->json(['data' => $data] + ($configuration ? ['meta'=>['configurationHash'=>$hash]] : []))->header('ETag', $tag);
    }
    public function configuration(Request $request) {
        $node = $this->node($request);
        $configuration = NodeV10Config::build($node);
        if (isset($configuration['domainTransition'])) abort_unless(in_array('certificate-transition-v1',explode(',',$request->header('X-Node-Capabilities','')),true),409,'请升级支持证书验证切换的 V2Box');
        if (!empty($configuration['singBox'])) {
            $features = explode(',', $request->header('X-Node-Capabilities', ''));
            abort_unless(in_array('native-routing-v1', $features, true), 409);
        }
        \App\Services\NodeRuntimeService::record('v2box', (int) $node->id, $configuration, 'v10');
        $response = $this->cached($request, $configuration, true);
        if (in_array('target-statistics-policy-v2', explode(',', $request->header('X-Node-Capabilities', '')), true)) {
            try { $response->header('X-Target-Statistics-Policy', json_encode(app(\App\Services\TargetStatistics::class)->nodePolicy())); }
            catch (\Throwable $e) { /* Optional telemetry must not interrupt configuration. */ }
        }
        return $response;
    }
    public function capabilities(Request $request) {
        $node = $this->node($request);
        $data = $request->validate(['coreVersion'=>'required|string|max:80', 'features'=>'present|array|max:32', 'features.*'=>'required|string|max:80|distinct',
            'configuration'=>'sometimes|array:hash,state,errorCode,certificateFingerprint,transitionId','configuration.hash'=>'required_with:configuration|string|regex:/^[a-f0-9]{64}$/',
            'configuration.transitionId'=>'sometimes|string|regex:/^[a-f0-9]{32}$/',
            'configuration.certificateFingerprint'=>'sometimes|string|regex:/^[a-f0-9]{64}$/',
            'configuration.state'=>'required_with:configuration|in:applied,failed','configuration.errorCode'=>'required_if:configuration.state,failed|in:decode,core,users,certificate,start'
        ]);
        $transitionAccepted=null;
        if (isset($data['configuration'])) {
            \App\Services\NodeRuntimeService::receipt((int)$node->id,$data['configuration']);
            if (in_array('certificate-transition-v1',$data['features'],true) && isset($data['configuration']['transitionId'])) $transitionAccepted=\App\Services\NodeTlsTransition::receipt((int)$node->id,$data['configuration']);
            unset($data['configuration']);
        }
        $data['reportedAt'] = gmdate('Y-m-d\TH:i:s\Z');
        Cache::put(\App\Utils\CacheKey::get('SERVER_V2BOX_LAST_CHECK_AT', $node->id), time(), 3600);
        Cache::put('V2BOX_CAPABILITIES:'.$node->id, $data, 86400);
        return response()->json(['data'=>['accepted'=>true]+($transitionAccepted!==null?['domainTransitionAccepted'=>$transitionAccepted]:[])]);
    }
    public function trafficBudget(Request $request) {
        $node=$this->node($request);
        $budget=\App\Services\ServerTrafficBudgetService::forNode('v2box',(int)$node->id);
        return response()->json(['data'=>$budget]);
    }
    public function users(Request $request) {
        $node = $this->node($request);
        $users = (\App\Services\ServerTrafficBudgetService::blocked('v2box',(int)$node->id) ? collect() : (new ServerService())->getAvailableUsers($node->group_id))->map(fn($u) => [
            'id'=>(int)$u->id, 'uuid'=>$u->uuid, 'speedLimit'=>(int)$u->speed_limit, 'deviceLimit'=>(int)$u->device_limit,
        ])->values()->all();
        return $this->cached($request, $users);
    }
    public function onlineCounts(Request $request) {
        $action = new NodeCommunication($this->node($request), 'v2box');
        $legacy = json_decode($action->alivelist($request)->getContent(), true);
        $data = [];
        foreach ($legacy['alive'] as $id => $count) $data[] = ['userId'=>(int)$id, 'count'=>(int)$count];
        return response()->json(['data'=>$data]);
    }
    public function traffic(Request $request) {
        $node = $this->node($request);
        $input = $request->validate(['batchId'=>'sometimes|required|uuid', 'records'=>'present|array|max:100000', 'records.*.userId'=>'required|integer|min:1|distinct', 'records.*.uploadBytes'=>'required|integer|min:0', 'records.*.downloadBytes'=>'required|integer|min:0']);
        $data = [];
        foreach ($input['records'] as $r) $data[(int)$r['userId']] = [(int)$r['uploadBytes'], (int)$r['downloadBytes']];
        if (isset($input['batchId'])) {
            $id = \App\Services\Actions\NodeTrafficBatch::receive($node, $input['batchId'], $data);
            // Scheduler recovers the durable batch if enqueueing fails or the worker dies.
            try { \App\Jobs\ProcessNodeTrafficBatch::dispatch($id); }
            catch (\Throwable $e) { \Log::error('Node traffic batch enqueue failed', ['batchRecordId'=>$id]); }
            Cache::put(\App\Utils\CacheKey::get('SERVER_V2BOX_ONLINE_USER', $node->id), count($data), 3600);
            Cache::put(\App\Utils\CacheKey::get('SERVER_V2BOX_LAST_PUSH_AT', $node->id), time(), 3600);
            return response()->json(['data'=>['accepted'=>true]], 202);
        }
        // Older V2Box clients retain the legacy accounting path.
        $legacy = Request::create('/', 'POST', [], [], [], ['CONTENT_TYPE'=>'application/json'], json_encode((object)$data));
        (new NodeCommunication($node, 'v2box'))->push($legacy);
        return response()->json(['data'=>['accepted'=>true]], 202);
    }
    public function onlineUsers(Request $request) {
        $node = $this->node($request);
        $input = $request->validate(['records'=>'present|array|max:100000', 'records.*.userId'=>'required|integer|min:1|distinct', 'records.*.ips'=>'present|array|max:10000', 'records.*.ips.*'=>'required|ip']);
        $data = [];
        foreach ($input['records'] as $r) $data[$r['userId']] = $r['ips'];
        $legacy = Request::create('/', 'POST', [], [], [], ['CONTENT_TYPE'=>'application/json'], json_encode((object)$data));
        (new NodeCommunication($node, 'v2box'))->alive($legacy);
        return response()->json(['data'=>['accepted'=>true]]);
    }
}
