<?php

namespace App\Http\Controllers\V2\Server;

use App\Http\Controllers\Controller;
use App\Services\ServerService;
use Illuminate\Http\Request;

class ServerController extends Controller
{
    private $nodeInfo;
    private $nodeId;
    private $serverService;

    private function initialize(Request $request): ?\Illuminate\Http\JsonResponse
    {
        $request->validate(['node_id'=>'required|integer|min:1','token'=>'sometimes|string']);
        $token = $request->bearerToken() ?? $request->input('token','');

        // token 为空（业务失败，不抛异常）
        if (empty($token)) {
            return response()->json([
                'status' => 'fail',
                'message' => 'token is null'
            ], 200);
        }

        $this->nodeId = (int)$request->input('node_id');
        $this->serverService = new ServerService();
        $nodeType = $request->input('node_type', 'v2box');
        abort_unless(in_array($nodeType, ['v2box'], true), 422, 'Unsupported node type');
        \App\Services\NodeCredentials::authenticate((string)$token,$nodeType,(int)$this->nodeId,$request->bearerToken()!==null);
        $this->nodeInfo = $this->serverService->getServer($this->nodeId, $nodeType);

        // 节点不存在
        if (!$this->nodeInfo) {
            return response()->json([
                'status' => 'fail',
                'message' => 'server is not exist'
            ], 200);
        }
        return null;
    }

    // 后端获取配置
    public function config(Request $request)
    {
        if ($error = $this->initialize($request)) return $error;
        $response = \App\Services\Actions\NodeConfiguration::build($this->nodeInfo);

        \App\Services\NodeRuntimeService::record($request->input('node_type', 'v2box'), (int) $this->nodeInfo->id, $response, 'v2');
        $rsp = json_encode($response);
        $eTag = sha1($rsp);

        // 不使用 abort(304)，避免异常路径
        $matches = array_map(fn($value)=>trim(preg_replace('/^W\//', '', trim($value)), '"'), explode(',', (string)$request->header('If-None-Match', '')));
        if (in_array($eTag, $matches, true) || in_array('*', $matches, true)) {
            return response('', 304)->header('ETag', "\"{$eTag}\"")->header('Cache-Control', 'private, no-store');
        }

        return response($response)->header('ETag', "\"{$eTag}\"")->header('Cache-Control', 'private, no-store');
    }
}
