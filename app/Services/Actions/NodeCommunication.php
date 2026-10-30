<?php

namespace App\Services\Actions;

use App\Models\RiskSetting;
use App\Services\OnlineDeviceService;
use App\Services\ServerService;
use App\Services\UserService;
use App\Utils\CacheKey;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use MessagePack\Packer;

class NodeCommunication
{
    private $nodeType;
    private $nodeId;
    private $nodeInfo;
    private $serverService;
    public function __construct($nodeInfo, string $nodeType) {
        $this->nodeInfo = $nodeInfo;
        $this->nodeType = $nodeType;
        $this->nodeId = $nodeInfo->id;
        $this->serverService = new ServerService();
    }
    // 后端获取用户
    public function user(Request $request)
    {
        ini_set('memory_limit', -1);
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_LAST_CHECK_AT', $this->nodeInfo->id), time(), 3600);
        $users = (\App\Services\ServerTrafficBudgetService::blocked($this->nodeType,(int)$this->nodeId) ? collect() : $this->serverService->getAvailableUsers($this->nodeInfo->group_id))
            ->map(function ($user) {
                return array_filter($user->toArray(), function ($v) {
                    return !is_null($v);
                });
            })->toArray();

        $response['users'] = $users;
        if (strpos($request->header('X-Response-Format'), 'msgpack') !== false) {
            $packer = new Packer();
            $response = $packer->pack($response);
            $eTag = sha1($response);
            if (strpos($request->header('If-None-Match'), $eTag) !== false) {
                abort(304);
            }

            return response($response, 200, ['Content-Type' => 'application/x-msgpack'])->header('ETag', "\"{$eTag}\"");
        } else {
            $eTag = sha1(json_encode($response));
            if (strpos($request->header('If-None-Match'), $eTag) !== false) {
                abort(304);
            }

            return response($response)->header('ETag', "\"{$eTag}\"");
        }
    }

    // 后端提交数据
    public function push(Request $request)
    {
        $data = $request->json()->all();
        if (empty($data)) {
            $data = $request->request->all();
        }
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // JSON decoding error
            return response([
                'error' => 'Invalid traffic data'
            ], 400);
        }
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_ONLINE_USER', $this->nodeInfo->id), count($data), 3600);
        Cache::put(CacheKey::get('SERVER_' . strtoupper($this->nodeType) . '_LAST_PUSH_AT', $this->nodeInfo->id), time(), 3600);
        $userService = new UserService();
        $userService->trafficFetch($this->nodeInfo->toArray(), $this->nodeType, $data);

        return response([
            'data' => true
        ]);
    }

    // 后端获取在线数据
    public function alivelist(Request $request)
    {
        $ids = (new UserService())->getDeviceLimitedUsers()->pluck('id')->all();
        $alive = [];
        foreach (OnlineDeviceService::forUsers($ids) as $id => $state) {
            if ($state['count'] > 0) $alive[$id] = $state['count'];
        }
        return response()->json(['alive' => (object)$alive]);
    }

    // 后端提交在线数据
    public function alive(Request $request)
    {
        $json = $request->isJson();
        $data = $json ? json_decode($request->getContent(), true) : $request->request->all();
        $valid = (!$json || json_last_error() === JSON_ERROR_NONE) && is_array($data);
        // Reject the entire report before an invalid row can clear other users.
        if ($valid) foreach ($data as $uid => $ips) {
            if (!ctype_digit((string) $uid) || filter_var($uid, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false || !is_array($ips)) {
                $valid = false;
                break;
            }
            foreach ($ips as $ip) {
                if (!is_string($ip) || !filter_var(explode('_', $ip, 2)[0], FILTER_VALIDATE_IP)) {
                    $valid = false;
                    break 2;
                }
            }
        }
        if (!$valid) {
            return response([
                'error' => 'Invalid online data format'
            ], 400);
        }
        (new OnlineDeviceService())->replace($this->nodeType, (int) $this->nodeId, $data, $this->getConnectionLogInterval());

        return response([
            'data' => true
        ]);
    }

    private function getConnectionLogInterval(): int
    {
        return (int) Cache::remember('RISK_CONNECTION_LOG_INTERVAL', 60, function () {
            $raw = RiskSetting::query()->where('key', 'connection_log_interval')->value('value');
            $value = (int) $raw;
            if ($value < 60) {
                $value = 3600;
            }
            return min($value, 86400);
        });
    }


}
