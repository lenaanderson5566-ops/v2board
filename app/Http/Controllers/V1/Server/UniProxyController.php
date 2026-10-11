<?php

namespace App\Http\Controllers\V1\Server;

use App\Http\Controllers\Controller;
use App\Models\UserConnectionLog;
use App\Models\UserOnlineSnapshot;
use App\Models\RiskSetting;
use App\Services\ServerService;
use App\Services\UserService;
use App\Utils\CacheKey;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use MessagePack\Packer;

class UniProxyController extends Controller
{
    private $nodeType;
    private $nodeInfo;
    private $nodeId;
    private $serverService;

    private function initialize(Request $request): void
    {
        $token = $request->input('token');
        if (empty($token)) {
            abort(500, 'token is null');
        }
        if ($token !== config('v2board.server_token')) {
            abort(500, 'token is error');
        }
        $this->nodeType = $request->input('node_type');
        abort_unless(in_array($this->nodeType, ['v2node', 'v2box'], true), 422, 'Unsupported node type');
        $this->nodeId = $request->input('node_id');
        $this->serverService = new ServerService();
        $this->nodeInfo = $this->serverService->getServer($this->nodeId, $this->nodeType);
        if (!$this->nodeInfo) abort(500, 'server is not exist');
        \App\Services\NodeAddressService::observe($request, $this->nodeType, (int) $this->nodeId);
    }

    public function user(Request $request) { $this->initialize($request); return (new \App\Services\Actions\NodeCommunication($this->nodeInfo, $this->nodeType))->user($request); }
    public function push(Request $request) { $this->initialize($request); return (new \App\Services\Actions\NodeCommunication($this->nodeInfo, $this->nodeType))->push($request); }
    public function alivelist(Request $request) { $this->initialize($request); return (new \App\Services\Actions\NodeCommunication($this->nodeInfo, $this->nodeType))->alivelist($request); }
    public function alive(Request $request) { $this->initialize($request); return (new \App\Services\Actions\NodeCommunication($this->nodeInfo, $this->nodeType))->alive($request); }
}
