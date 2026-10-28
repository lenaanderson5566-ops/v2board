<?php

namespace App\Services;

use App\Models\ServerRoute;
use App\Models\ServerV2box;
use App\Models\User;
use App\Utils\CacheKey;
use Illuminate\Support\Facades\Cache;

class ServerService
{
    public function getAvailableV2box(User $user, string $type = 'v2box')
    {
        $servers = [];
        if (!in_array($type, ['v2box'], true)) throw new \InvalidArgumentException('Unsupported node type');
        $modelClass = ServerV2box::class;
        $model = $modelClass::orderBy('sort', 'ASC');
        $nodes = $model->get()->keyBy('id');
        $maintenance = NodeMaintenance::active();
        foreach ($nodes as $key => $v) {
            if ($v['service_id']) {
                $service=$nodes->get($v['service_id']);
                if (!$service || $service->service_id || !in_array(TrafficCreditService::effectiveGroupId($user),(array)$service->group_id)) continue;
                foreach (ProxyService::FIELDS as $field) $v[$field]=$service[$field];
                $v['updated_at']=max($v->getRawOriginal('updated_at'),$service->getRawOriginal('updated_at'));
            }
            if (NodeMaintenance::hidden($maintenance, $type, (int)$v['id'], $v['service_id'])) continue;
            if (!$v['show']) continue;
            $nodes[$key]['type'] = $type;
            $nodes[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['id']));
            if (!in_array(TrafficCreditService::effectiveGroupId($user), $v['group_id'])) continue;
            if (isset($nodes[$v['service_id']])) {
                $nodes[$key]['last_check_at'] = Cache::get(CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $v['service_id']));
                $nodes[$key]['created_at'] = $nodes[$v['service_id']]['created_at'];
            }
            if (isset($nodes[$key]['tls_settings'])) {
                $nodes[$key]['tls_settings'] = array_diff_key(
                    $nodes[$key]['tls_settings'],
                    array_flip(array_filter(['private_key', 'ech_key', 'tls_key', 'dns_env', 'dns_credential_id'], function($k) use ($nodes, $key) {
                        return isset($nodes[$key]['tls_settings'][$k]);
                    }))
                );
            }
            if (isset($nodes[$key]['encryption_settings'])) {
                if (isset($nodes[$key]['encryption_settings']['private_key'])) {
                    $nodes[$key]['encryption_settings'] = array_diff_key($nodes[$key]['encryption_settings'], array('private_key' => ''));
                }
            }
            $publicNode = $nodes[$key]->toArray();
            unset($publicNode['sing_box']); // Server egress credentials are never subscription data.
            unset($publicNode['service_id']);
            $servers[] = $publicNode;
        }
        return $servers;
    }

    public function getAvailableServers(User $user)
    {
        $servers = $this->getAvailableV2box($user);
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

    public function getAllV2box(string $type = 'v2box')
    {
        if (!in_array($type, ['v2box'], true)) throw new \InvalidArgumentException('Unsupported node type');
        $modelClass = ServerV2box::class;
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
            $entry = NodeDeployment::bootstrapCommand($apiHost) . ' --install v1.0.16';
            $servers[$k]['upgrade_command'] = $entry . ' --update';
            $servers[$k]['install_command'] = sprintf(
                $entry . ' --node-type v2box --api-host %s --node-id %d --prompt-api-key',
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
        return Cache::remember('ADMIN_NODE_ACTIVITY:v3',5,function(){
            $nodes=\Illuminate\Support\Facades\DB::table('v2_server_v2box')->select('id','service_id')->selectRaw("'v2box' as type")->get();
            return $this->activity($nodes->map(fn($node)=>(array)$node)->all());
        });
    }

    private function mergeData(&$servers)
    {
        foreach ($this->activity($servers) as $index=>$activity) $servers[$index]=array_replace($servers[$index],$activity);
    }

    public function getAllServers()
    {
        $servers = $this->getAllV2box();
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

    public function getRoutes(array $routeIds, string $backend = 'v2box')
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
        }
    }
}
