<?php

namespace App\Services;

use App\Models\ServerLog;
use App\Models\ServerRoute;
use App\Models\ServerV2node;
use App\Models\ServerV2box;
use App\Models\User;
use App\Utils\CacheKey;
use Illuminate\Support\Facades\Cache;

class ServerService
{
    public function getAvailableV2node(User $user, string $type = 'v2node')
    {
        $servers = [];
        if (!in_array($type, ['v2node', 'v2box'], true)) throw new \InvalidArgumentException('Unsupported node type');
        $modelClass = $type === 'v2box' ? ServerV2box::class : ServerV2node::class;
        $model = $modelClass::orderBy('sort', 'ASC');
        $v2node = $model->get()->keyBy('id');
        foreach ($v2node as $key => $v) {
            if (!$v['show']) continue;
            $v2node[$key]['type'] = $type;
            $v2node[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['id']));
            if (!in_array(TrafficCreditService::effectiveGroupId($user), $v['group_id'])) continue;
            if (isset($v2node[$v['parent_id']])) {
                $v2node[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['parent_id']));
                $v2node[$key]['created_at'] = $v2node[$v['parent_id']]['created_at'];
            }
            if (isset($v2node[$key]['tls_settings'])) {
                $v2node[$key]['tls_settings'] = array_diff_key(
                    $v2node[$key]['tls_settings'],
                    array_flip(array_filter(['private_key', 'ech_key', 'tls_key'], function($k) use ($v2node, $key) {
                        return isset($v2node[$key]['tls_settings'][$k]);
                    }))
                );
            }
            if (isset($v2node[$key]['encryption_settings'])) {
                if (isset($v2node[$key]['encryption_settings']['private_key'])) {
                    $v2node[$key]['encryption_settings'] = array_diff_key($v2node[$key]['encryption_settings'], array('private_key' => ''));
                }
            }
            $publicNode = $v2node[$key]->toArray();
            unset($publicNode['sing_box']); // Server egress credentials are never subscription data.
            $servers[] = $publicNode;
        }
        return $servers;
    }

    public function getAvailableServers(User $user)
    {
        $servers = array_merge(
            $this->getAvailableV2node($user),
            $this->getAvailableV2node($user, 'v2box')
        );
        $tmp = array_column($servers, 'sort');
        array_multisort($tmp, SORT_ASC, $servers);
        return array_map(function ($server) {
            if (strpos($server['port'], '-')) {
                $server['mport'] = (string)$server['port'];
            } else {
                $server['port'] = (int)$server['port'];
            }
            $server['is_online'] = (time() - 300 > $server['last_check_at']) ? 0 : 1;
            $server['cache_key'] = "{$server['type']}-{$server['id']}-{$server['updated_at']}-{$server['is_online']}";
            return $server;
        }, $servers);
    }

    public function getAvailableUsers($groupId)
    {
        return TrafficCreditService::constrainGroups(User::withUsableTraffic(), (array)$groupId)
            ->select([
                'id',
                'uuid',
                'speed_limit',
                'device_limit'
            ])
            ->get();
    }

    public function log(int $userId, int $serverId, int $u, int $d, float $rate, string $method)
    {
        if (($u + $d) < 10240) return true;
        $timestamp = strtotime(date('Y-m-d'));
        $serverLog = ServerLog::where('log_at', '>=', $timestamp)
            ->where('log_at', '<', $timestamp + 3600)
            ->where('server_id', $serverId)
            ->where('user_id', $userId)
            ->where('rate', $rate)
            ->where('method', $method)
            ->first();
        if ($serverLog) {
            try {
                $serverLog->increment('u', $u);
                $serverLog->increment('d', $d);
                return true;
            } catch (\Exception $e) {
                return false;
            }
        } else {
            $serverLog = new ServerLog();
            $serverLog->user_id = $userId;
            $serverLog->server_id = $serverId;
            $serverLog->u = $u;
            $serverLog->d = $d;
            $serverLog->rate = $rate;
            $serverLog->log_at = $timestamp;
            $serverLog->method = $method;
            return $serverLog->save();
        }
    }

    public function getAllV2node(string $type = 'v2node')
    {
        if (!in_array($type, ['v2node', 'v2box'], true)) throw new \InvalidArgumentException('Unsupported node type');
        $modelClass = $type === 'v2box' ? ServerV2box::class : ServerV2node::class;
        $servers = $modelClass::orderBy('sort', 'ASC')
            ->get()
            ->toArray();
        foreach ($servers as $k => $v) {
            $servers[$k]['type'] = $type;
            if (isset($v['padding_scheme'])) {
                $servers[$k]['padding_scheme'] = json_encode($v['padding_scheme']);
            }

            $apiHost = config('v2board.server_api_url', config('v2board.app_url'));
            $apiKey = config('v2board.server_token', '');
            $nodeId = (int) $v['id'];
            $apiHostArg = escapeshellarg((string) $apiHost);
            $apiKeyArg = escapeshellarg((string) $apiKey);
            $servers[$k]['install_command'] = sprintf(
                $type === 'v2box'
                    ? 'curl -fSL https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/main/script/install.sh -o install-v2box.sh && bash install-v2box.sh --node-type v2box --api-host %s --node-id %d --api-key %s'
                    : 'wget -N https://raw.githubusercontent.com/wyx2685/v2node/master/script/install.sh && bash install.sh --api-host %s --node-id %d --api-key %s',
                $apiHostArg,
                $nodeId,
                $apiKeyArg
            );
        }
        return $servers;
    }

    private function mergeData(&$servers)
    {
        foreach ($servers as $k => $v) {
            $serverType = strtoupper($v['type']);
            $servers[$k]['online'] = Cache::get(CacheKey::get("SERVER_{$serverType}_ONLINE_USER", $v['parent_id'] ?? $v['id']));
            $servers[$k]['last_check_at'] = Cache::get(CacheKey::get("SERVER_{$serverType}_LAST_CHECK_AT", $v['parent_id'] ?? $v['id']));
            $servers[$k]['last_push_at'] = Cache::get(CacheKey::get("SERVER_{$serverType}_LAST_PUSH_AT", $v['parent_id'] ?? $v['id']));
            if ((time() - 300) >= $servers[$k]['last_check_at']) {
                $servers[$k]['available_status'] = 0;
            } else if ((time() - 300) >= $servers[$k]['last_push_at']) {
                $servers[$k]['available_status'] = 1;
            } else {
                $servers[$k]['available_status'] = 2;
            }
        }
    }

    public function getAllServers()
    {
        $servers = array_merge(
            $this->getAllV2node(),
            $this->getAllV2node('v2box')
        );
        $this->mergeData($servers);
        $servers = NodeAddressService::forNodes($servers);
        $servers = ServerTrafficBudgetService::decorateNodes($servers);
        $tmp = array_column($servers, 'sort');
        array_multisort($tmp, SORT_ASC, $servers);
        return $servers;
    }

    public function getRoutes(array $routeIds, string $backend = 'v2node')
    {
        if (!$routeIds) return collect();
        $routeIds = array_map('intval', $routeIds);
        $order = implode(',', $routeIds);
        $routes = ServerRoute::select(['id', 'match', 'action', 'action_value'])
            ->where('backend', $backend)->where('action', '!=', 'sing_box')
            ->whereIn('id', $routeIds)
            ->orderByRaw("FIELD(id, $order)")
            ->get();
        foreach ($routes as $k => $route) {
            $array = json_decode($route->match, true);
            if (is_array($array)) $routes[$k]['match'] = $array;
        }
        return $routes;
    }

    public function getServer($serverId, $serverType)
    {
        switch ($serverType) {
            case 'v2box':
                return ServerV2box::find($serverId);
            case 'v2node':
                return ServerV2node::find($serverId);
        }
    }
}
