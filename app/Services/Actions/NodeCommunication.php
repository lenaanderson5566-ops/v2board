<?php

namespace App\Services\Actions;

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
        $users = $this->serverService->getAvailableUsers($this->nodeInfo->group_id)
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
        $alive = Cache::remember('ALIVE_LIST', 60, function () {
            $userService = new UserService();
            $users = $userService->getDeviceLimitedUsers();

            if ($users->isEmpty()) {
                return [];
            }

            $keys = [];
            $idMap = [];
            foreach ($users as $user) {
                $key = 'ALIVE_IP_USER_' . $user->id;
                $keys[] = $key;
                $idMap[$key] = $user->id;
            }

            $results = Cache::many($keys);
            $alive = [];
            foreach ($results as $key => $data) {
                if (is_array($data) && isset($data['alive_ip'])) {
                    $alive[$idMap[$key]] = $data['alive_ip'];
                }
            }
            return $alive;
        });
        return response()->json(['alive' => (object)$alive]);
    }

    // 后端提交在线数据
    public function alive(Request $request)
    {
        $data = $request->json()->all();
        if (empty($data)) {
            $data = $request->request->all();
        }
        if (empty($data)) {
            return response([
                'data' => true
            ]);
        }
        if (!is_array($data)) {
            return response([
                'error' => 'Invalid online data format'
            ], 400);
        }
        $updateAt = time();
        $connectionLogInterval = $this->getConnectionLogInterval();

        $cacheKeys = [];
        $keyMap = [];
        foreach ($data as $uid => $_) {
            if (!is_numeric($uid)) continue;
            $key = 'ALIVE_IP_USER_' . $uid;
            $cacheKeys[] = $key;
            $keyMap[$uid] = $key;
        }

        if (empty($cacheKeys)) {
            return response([
                'data' => true
            ]);
        }

        $cachedData = Cache::many($cacheKeys);
        $updates = [];

        foreach ($data as $uid => $ips) {
            if (!is_numeric($uid) || !is_array($ips)) {
                continue; // 跳过无效数据
            }
            $key = $keyMap[$uid];
            $ips_array = $cachedData[$key] ?? [];

            // 更新节点数据
            $ips_array[$this->nodeType . $this->nodeId] = ['aliveips' => $ips, 'lastupdateAt' => $updateAt];

            $seen = [];
            foreach ($ips as $ipNodeId) {
                $ip = explode('_', (string) $ipNodeId)[0] ?? '';
                if (!$ip || isset($seen[$ip])) {
                    continue;
                }
                $seen[$ip] = true;
                UserOnlineSnapshot::query()->updateOrCreate(
                    [
                        'user_id' => (int) $uid,
                        'source' => 'alive',
                    ],
                    [
                        'ip' => $ip,
                        'node' => $this->nodeType . $this->nodeId,
                        'online_at' => $updateAt,
                    ]
                );

                $connectionLogThrottleKey = sprintf(
                    'USER_CONNECTION_LOG:%d:%s:%s',
                    (int) $uid,
                    md5($ip),
                    $this->nodeType . $this->nodeId
                );
                if (!Cache::has($connectionLogThrottleKey)) {
                    UserConnectionLog::query()->create([
                        'user_id' => (int) $uid,
                        'ip' => $ip,
                        'node' => $this->nodeType . $this->nodeId,
                        'source' => 'alive',
                        'connected_at' => $updateAt,
                    ]);
                    Cache::put($connectionLogThrottleKey, 1, $connectionLogInterval);
                }
            }

            // 清理过期数据
            foreach ($ips_array as $nodetypeid => $oldips) {
                if ($nodetypeid !== 'alive_ip' && is_array($oldips) && ($updateAt - ($oldips['lastupdateAt'] ?? 0) > 100)) {
                    unset($ips_array[$nodetypeid]);
                }
            }

            // 计算活跃IP数量
            $count = 0;
            if (config('v2board.device_limit_mode', 0) == 1) {
                $ipmap = [];
                foreach ($ips_array as $nodetypeid => $newdata) {
                    if ($nodetypeid !== 'alive_ip' && is_array($newdata) && isset($newdata['aliveips'])) {
                        foreach ($newdata['aliveips'] as $ip_NodeId) {
                            $ip = explode("_", $ip_NodeId)[0];
                            $ipmap[$ip] = 1;
                        }
                    }
                }
                $count = count($ipmap);
            } else {
                foreach ($ips_array as $nodetypeid => $newdata) {
                    if ($nodetypeid !== 'alive_ip' && is_array($newdata) && isset($newdata['aliveips'])) {
                        $count += count($newdata['aliveips']);
                    }
                }
            }
            $ips_array['alive_ip'] = $count;

            $updates[$key] = $ips_array;
        }

        // 批量更新缓存
        foreach ($updates as $key => $value) {
            Cache::put($key, $value, 120);
        }

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
