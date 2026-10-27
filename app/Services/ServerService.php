<?php

namespace App\Services;

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
        $maintenance = NodeMaintenance::active();
        foreach ($v2node as $key => $v) {
            if ($v['service_id']) {
                $service=$v2node->get($v['service_id']);
                if (!$service || $service->service_id || !in_array(TrafficCreditService::effectiveGroupId($user),(array)$service->group_id)) continue;
                foreach (ProxyService::FIELDS as $field) $v[$field]=$service[$field];
                $v['updated_at']=max($v->getRawOriginal('updated_at'),$service->getRawOriginal('updated_at'));
            }
            if (NodeMaintenance::hidden($maintenance, $type, (int)$v['id'], $v['service_id'])) continue;
            if (!$v['show']) continue;
            $v2node[$key]['type'] = $type;
            $v2node[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['id']));
            if (!in_array(TrafficCreditService::effectiveGroupId($user), $v['group_id'])) continue;
            if (isset($v2node[$v['service_id']])) {
                $v2node[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['service_id']));
                $v2node[$key]['created_at'] = $v2node[$v['service_id']]['created_at'];
            }
            if (isset($v2node[$key]['tls_settings'])) {
                $v2node[$key]['tls_settings'] = array_diff_key(
                    $v2node[$key]['tls_settings'],
                    array_flip(array_filter(['private_key', 'ech_key', 'tls_key', 'dns_env', 'dns_credential_id'], function($k) use ($v2node, $key) {
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
            unset($publicNode['service_id']);
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
        foreach ($servers as &$server) {
            $server['runtime_status'] = NodeRuntimeService::connection($server['last_check_at'] ?? null, $server['last_push_at'] ?? null, (bool) ($server['traffic_budget']['blocked'] ?? false));
        }
        unset($server);
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
            if (!empty($v['service_id'])) continue; // Connections are never deployment targets.

            $apiHost = rtrim((string)(config('v2board.server_api_url') ?: config('v2board.app_url')), '/');
            $nodeId = (int) $v['id'];
            $apiHostArg = escapeshellarg((string) $apiHost);
            $scriptUrl = rtrim((string)$apiHost, '/') . '/api/v10/public/node-deployment/bootstrap';
            $entry = 'wget --https-only -O install-v2box.sh ' . escapeshellarg($scriptUrl) . ' && sh install-v2box.sh --install v1.0.14';
            if ($type === 'v2box') $servers[$k]['upgrade_command'] = $entry . ' --update';
            $servers[$k]['install_command'] = sprintf(
                $type === 'v2box'
                    ? $entry . ' --node-type v2box --api-host %s --node-id %d --prompt-api-key'
                    : 'wget -N https://raw.githubusercontent.com/wyx2685/v2node/master/script/install.sh && bash install.sh --api-host %s --node-id %d',
                $apiHostArg,
                $nodeId
            );
        }
        $services=array_column($servers,null,'id');
        foreach($servers as &$line) {
            if (!empty($line['service_id']) && isset($services[$line['service_id']]) && empty($services[$line['service_id']]['service_id'])) {
                $line=ProxyService::overlay($line,$services[$line['service_id']]);
            }
        }
        unset($line);
        return $servers;
    }

    /** Only service-level cached counters; no per-user scans or provider calls. */
    public function activity(array $servers): array
    {
        $roots=[];$keys=[];$now=time();
        foreach ($servers as $server) {
            if (!empty($server['service_id'])) continue;
            $identity=$server['type'].':'.$server['id'];
            if (isset($roots[$identity])) continue;
            $roots[$identity]=true;$type=strtoupper($server['type']);
            foreach (['ONLINE_USER','LAST_CHECK_AT','LAST_PUSH_AT'] as $suffix) $keys[]=CacheKey::get("SERVER_{$type}_{$suffix}",$server['id']);
        }
        $cache=$keys?Cache::many($keys):[];
        $result=[];
        foreach ($servers as $server) {
            $root=($server['service_id']??null) ?: $server['id'];$type=strtoupper($server['type']);
            $valid=isset($roots[$server['type'].':'.$root]);
            $checked=$valid ? ($cache[CacheKey::get("SERVER_{$type}_LAST_CHECK_AT",$root)]??null):null;
            $pushed=$valid ? ($cache[CacheKey::get("SERVER_{$type}_LAST_PUSH_AT",$root)]??null):null;
            $online=$valid ? ($cache[CacheKey::get("SERVER_{$type}_ONLINE_USER",$root)]??null):null;
            $stale=!$pushed || $pushed<=$now-300;
            $result[]=['id'=>$server['id'],'type'=>$server['type'],'service_id'=>$server['service_id']??null,
                'online'=>$stale || $online===null ? null : max(0,(int)$online), 'online_stale'=>$stale,
                'last_check_at'=>$checked,'last_push_at'=>$pushed,
                'runtime_status'=>NodeRuntimeService::connection($checked,$pushed,false),
                'available_status'=>!$checked || $checked<=$now-300 ? 0 : ($stale?1:2)];
        }
        return $result;
    }

    public function getNodeActivity(): array
    {
        // Briefly share results across administrators without caching service configuration.
        return Cache::remember('ADMIN_NODE_ACTIVITY:v2',5,function(){
            $nodes=\Illuminate\Support\Facades\DB::table('v2_server_v2node')->select('id','service_id')->selectRaw("'v2node' as type")
                ->unionAll(\Illuminate\Support\Facades\DB::table('v2_server_v2box')->select('id','service_id')->selectRaw("'v2box' as type"))->get();
            return $this->activity($nodes->map(fn($node)=>(array)$node)->all());
        });
    }

    private function mergeData(&$servers)
    {
        foreach ($this->activity($servers) as $index=>$activity) $servers[$index]=array_replace($servers[$index],$activity);
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
        $servers = NodeRuntimeService::decorate($servers);
        foreach ($servers as &$server) {
            $server['runtime_status'] = NodeRuntimeService::connection($server['last_check_at'] ?? null, $server['last_push_at'] ?? null, (bool) ($server['traffic_budget']['blocked'] ?? false));
        }
        unset($server);
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
