<?php

namespace App\Http\Controllers\V1\Server;

use App\Http\Controllers\Controller;
use App\Services\ServerService;
use Illuminate\Http\Request;

class UniProxyController extends Controller
{
    private $nodeType;
    private $nodeInfo;
    private $nodeId;
    private $serverService;

    private function initialize(Request $request): void
    {
        $request->validate(['node_id'=>'required|integer|min:1','token'=>'sometimes|string']);
        $token = $request->bearerToken() ?? $request->input('token','');
        $this->nodeType = $request->input('node_type');
        abort_unless(in_array($this->nodeType, ['v2box'], true), 422, 'Unsupported node type');
        $this->nodeId = (int)$request->input('node_id');
        \App\Services\NodeCredentials::authenticate((string)$token,$this->nodeType,(int)$this->nodeId,$request->bearerToken()!==null);
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
