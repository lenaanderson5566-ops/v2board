<?php
namespace App\Http\Controllers\V10;

use App\Http\Controllers\Controller;
use App\Services\ServerService;
use App\Services\Actions\NodeCommunication;
use App\Services\Actions\NodeV10Config;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class NodeController extends Controller {
    private function node(Request $request) {
        // Only V2Box implements this machine contract today; reject unknown types
        // rather than looking up a colliding ID in the wrong backend table.
        abort_unless($request->header('X-Node-Type') === 'v2box', 422);
        $id = $request->header('X-Node-ID');
        abort_unless(ctype_digit((string) $id) && filter_var($id, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]) !== false, 422);
        $node = (new ServerService())->getServer((int) $id, 'v2box');
        abort_unless($node, 404);
        return $node;
    }
    private function cached(Request $request, array $data) {
        $tag = '"'.hash('sha256', json_encode($data)).'"';
        if ($request->header('If-None-Match') === $tag) return response('', 304)->header('ETag', $tag);
        return response()->json(['data' => $data])->header('ETag', $tag);
    }
    public function configuration(Request $request) {
        $node = $this->node($request);
        if (!empty($node->sing_box)) {
            $features = explode(',', $request->header('X-Node-Capabilities', ''));
            abort_unless(in_array('native-routing-v1', $features, true), 409);
        }
        return $this->cached($request, NodeV10Config::build($node));
    }
    public function capabilities(Request $request) {
        $node = $this->node($request);
        $data = $request->validate(['coreVersion'=>'required|string|max:80', 'features'=>'present|array|max:32', 'features.*'=>'required|string|max:80|distinct']);
        $data['reportedAt'] = gmdate('Y-m-d\TH:i:s\Z');
        Cache::put(\App\Utils\CacheKey::get('SERVER_V2BOX_LAST_CHECK_AT', $node->id), time(), 3600);
        Cache::put('V2BOX_CAPABILITIES:'.$node->id, $data, 86400);
        return response()->json(['data'=>['accepted'=>true]]);
    }
    public function users(Request $request) {
        $node = $this->node($request);
        $users = (new ServerService())->getAvailableUsers($node->group_id)->map(fn($u) => [
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
        $input = $request->validate(['records'=>'present|array|max:100000', 'records.*.userId'=>'required|integer|min:1|distinct', 'records.*.uploadBytes'=>'required|integer|min:0', 'records.*.downloadBytes'=>'required|integer|min:0']);
        $data = [];
        foreach ($input['records'] as $r) $data[$r['userId']] = [$r['uploadBytes'], $r['downloadBytes']];
        // Same accounting jobs as legacy. Batch deduplication is intentionally deferred.
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
