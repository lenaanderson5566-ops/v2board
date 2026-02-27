<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\RiskRuleHit;
use App\Models\RiskRuleConfig;
use App\Models\SubscribeLog;
use App\Models\User;
use App\Models\Order;
use App\Models\Plan;
use App\Models\ServerGroup;
use App\Models\UserConnectionLog;
use App\Models\UserOnlineSnapshot;
use App\Models\RiskSetting;
use App\Services\RiskLogService;
use App\Services\ClientStrategyService;
use App\Services\RiskBlacklistService;
use App\Services\GeoIpService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LogController extends Controller
{
    public function getOverview(Request $request)
    {
        $now = time();

        $loginToday = LoginLog::query()->where('created_at', '>=', $now - 86400);
        $subscribeToday = SubscribeLog::query()->where('created_at', '>=', $now - 86400);

        return response([
            'data' => [
                'login_total_24h' => (clone $loginToday)->count(),
                'login_failed_24h' => (clone $loginToday)->where('is_success', 0)->count(),
                'login_failed_rate_24h' => $this->percent(
                    (clone $loginToday)->count(),
                    (clone $loginToday)->where('is_success', 0)->count()
                ),
                'subscribe_total_24h' => (clone $subscribeToday)->count(),
                'subscribe_failed_24h' => (clone $subscribeToday)->where('status', 'failed')->count(),
                'subscribe_failed_rate_24h' => $this->percent(
                    (clone $subscribeToday)->count(),
                    (clone $subscribeToday)->where('status', 'failed')->count()
                ),
                'rule_hit_total_24h' => RiskRuleHit::query()->where('hit_at', '>=', $now - 86400)->count(),
                'latest_rule_hits' => RiskRuleHit::query()->orderBy('id', 'desc')->limit(10)->get(),
            ]
        ]);
    }

    public function getRules(Request $request)
    {
        $rules = (new RiskLogService())->getRuleDefinitions();

        if ($request->has('enabled') && $request->input('enabled') !== '') {
            $enabled = (int) $request->input('enabled');
            $rules = array_values(array_filter($rules, function ($rule) use ($enabled) {
                return (int) $rule['enabled'] === $enabled;
            }));
        }

        return response([
            'data' => $rules
        ]);
    }


    public function updateRule(Request $request)
    {
        $params = $request->validate([
            'rule_key' => 'required|string',
            'name' => 'nullable|string',
            'description' => 'nullable|string',
            'risk_level' => 'nullable|string',
            'enabled' => 'nullable',
            'sort' => 'nullable|integer',
            'thresholds' => 'nullable',
        ]);

        $definitions = RiskLogService::defaultRuleDefinitions();
        $ruleKey = $params['rule_key'];
        if (!isset($definitions[$ruleKey])) {
            abort(422, 'unknown rule_key');
        }

        $default = $definitions[$ruleKey];
        $existing = RiskRuleConfig::query()->where('rule_key', $ruleKey)->first();

        if (array_key_exists('risk_level', $params) && !is_null($params['risk_level'])) {
            $allowedRiskLevels = ['low', 'medium', 'high'];
            if (!in_array($params['risk_level'], $allowedRiskLevels, true)) {
                abort(422, 'risk_level must be one of: low, medium, high');
            }
        }

        $thresholds = $params['thresholds'] ?? null;
        if (is_string($thresholds)) {
            $decoded = json_decode($thresholds, true);
            if (!is_array($decoded)) {
                abort(422, 'thresholds must be a valid json object');
            }
            $thresholds = $decoded;
        }
        if (!is_null($thresholds) && !is_array($thresholds)) {
            abort(422, 'thresholds must be an array');
        }
        if (is_array($thresholds)) {
            $allowedThresholdKeys = array_keys($default['thresholds']);
            foreach ($thresholds as $thresholdKey => $thresholdValue) {
                if (!in_array($thresholdKey, $allowedThresholdKeys, true)) {
                    abort(422, 'thresholds contains unknown key: ' . $thresholdKey);
                }
                if (filter_var($thresholdValue, FILTER_VALIDATE_INT) === false) {
                    abort(422, 'thresholds.' . $thresholdKey . ' must be integer');
                }
                if ((int) $thresholdValue < 0) {
                    abort(422, 'thresholds.' . $thresholdKey . ' must be >= 0');
                }
                $thresholds[$thresholdKey] = (int) $thresholdValue;
            }
        }

        RiskRuleConfig::updateOrCreate(
            ['rule_key' => $ruleKey],
            [
                'scene' => $default['scene'],
                'name' => $params['name'] ?? ($existing->name ?? $default['name']),
                'description' => array_key_exists('description', $params)
                    ? $params['description']
                    : ($existing->description ?? $default['description']),
                'risk_level' => $params['risk_level'] ?? ($existing->risk_level ?? $default['risk_level']),
                'thresholds' => is_null($thresholds)
                    ? (($existing && is_array($existing->thresholds)) ? array_merge($default['thresholds'], $existing->thresholds) : $default['thresholds'])
                    : array_merge($default['thresholds'], $thresholds),
                'enabled' => array_key_exists('enabled', $params)
                    ? (int) (bool) $params['enabled']
                    : (($existing && !is_null($existing->enabled)) ? (int) $existing->enabled : 1),
                'sort' => $params['sort'] ?? ($existing->sort ?? $default['sort']),
            ]
        );

        return response([
            'data' => (new RiskLogService())->getRuleDefinitions()
        ]);
    }



    public function resetRule(Request $request)
    {
        $definitions = RiskLogService::defaultRuleDefinitions();
        $ruleKey = (string) $request->input('rule_key', '');

        if ($ruleKey !== '') {
            if (!isset($definitions[$ruleKey])) {
                abort(422, 'unknown rule_key');
            }
            RiskRuleConfig::query()->where('rule_key', $ruleKey)->delete();
        } else {
            RiskRuleConfig::query()->whereIn('rule_key', array_keys($definitions))->delete();
        }

        return response([
            'data' => (new RiskLogService())->getRuleDefinitions()
        ]);
    }

    public function getClientStrategies(Request $request)
    {
        $strategies = (new ClientStrategyService())->getStrategies();

        return response([
            'data' => $this->appendClientSubscribeStats($strategies)
        ]);
    }

    public function updateClientStrategy(Request $request)
    {
        $rawItems = $request->input('items');
        if (is_null($rawItems)) {
            $rawItems = [$request->all()];
        }

        if (!is_array($rawItems)) {
            abort(422, 'items must be an array');
        }

        $items = [];
        foreach ($rawItems as $item) {
            if (!is_array($item)) {
                abort(422, 'each item must be an object');
            }
            if (empty($item['client_type']) || !is_string($item['client_type'])) {
                abort(422, 'client_type is required');
            }
            if (array_key_exists('sort', $item) && filter_var($item['sort'], FILTER_VALIDATE_INT) === false) {
                abort(422, 'sort must be integer');
            }
            if (array_key_exists('is_enabled', $item)) {
                $enabled = filter_var($item['is_enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if (is_null($enabled)) {
                    abort(422, 'is_enabled must be boolean');
                }
                $item['is_enabled'] = $enabled;
            }
            if (array_key_exists('client_name', $item) && !is_null($item['client_name']) && !is_string($item['client_name'])) {
                abort(422, 'client_name must be string');
            }
            if (array_key_exists('min_version', $item) && !is_null($item['min_version']) && !is_string($item['min_version'])) {
                abort(422, 'min_version must be string');
            }
            $item['client_type'] = strtolower($item['client_type']);
            $items[] = $item;
        }

        $strategies = (new ClientStrategyService())->updateStrategies($items);

        return response([
            'data' => $this->appendClientSubscribeStats($strategies)
        ]);
    }


    public function deleteClientStrategy(Request $request)
    {
        $clientType = strtolower((string) $request->input('client_type', ''));
        if (!$clientType) {
            abort(422, 'client_type is required');
        }

        (new ClientStrategyService())->deleteStrategy($clientType);

        $strategies = (new ClientStrategyService())->getStrategies();

        return response([
            'data' => $this->appendClientSubscribeStats($strategies)
        ]);
    }


    private function appendClientSubscribeStats($strategies)
    {
        $items = collect($strategies)->map(function ($item) {
            return is_array($item) ? $item : $item->toArray();
        });

        if ($items->isEmpty()) {
            return $items;
        }

        $now = time();
        $cutoff24h = $now - 86400;
        $cutoff30d = $now - (30 * 86400);

        $clientTypes = $items->pluck('client_type')
            ->map(function ($type) {
                return strtolower(trim((string) $type));
            })
            ->filter()
            ->unique()
            ->values()
            ->toArray();

        $flag24hRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as normalized_client_type, COUNT(*) as hit_count')
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->where('created_at', '>=', $cutoff24h)
            ->whereIn(DB::raw('LOWER(TRIM(client_type))'), $clientTypes)
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->get();

        $flag30dRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as normalized_client_type, COUNT(*) as hit_count')
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->where('created_at', '>=', $cutoff30d)
            ->whereIn(DB::raw('LOWER(TRIM(client_type))'), $clientTypes)
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->get();

        $ua24hRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as normalized_client_type, COUNT(DISTINCT user_agent) as ua_count')
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->where('created_at', '>=', $cutoff24h)
            ->whereIn(DB::raw('LOWER(TRIM(client_type))'), $clientTypes)
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->get();

        $ua30dRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as normalized_client_type, COUNT(DISTINCT user_agent) as ua_count')
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->where('created_at', '>=', $cutoff30d)
            ->whereIn(DB::raw('LOWER(TRIM(client_type))'), $clientTypes)
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->get();

        $uaStatRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as normalized_client_type, user_agent, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as count_24h, COUNT(*) as count_30d', [$cutoff24h])
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->where('created_at', '>=', $cutoff30d)
            ->whereIn(DB::raw('LOWER(TRIM(client_type))'), $clientTypes)
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'), 'user_agent')
            ->orderBy('count_30d', 'desc')
            ->orderBy('count_24h', 'desc')
            ->get();

        $flag24hMap = [];
        foreach ($flag24hRows as $row) {
            $flag24hMap[(string) $row->normalized_client_type] = (int) $row->hit_count;
        }

        $flag30dMap = [];
        foreach ($flag30dRows as $row) {
            $flag30dMap[(string) $row->normalized_client_type] = (int) $row->hit_count;
        }

        $ua24hMap = [];
        foreach ($ua24hRows as $row) {
            $ua24hMap[(string) $row->normalized_client_type] = (int) $row->ua_count;
        }

        $ua30dMap = [];
        foreach ($ua30dRows as $row) {
            $ua30dMap[(string) $row->normalized_client_type] = (int) $row->ua_count;
        }

        $uaTopMap = [];
        foreach ($uaStatRows as $row) {
            $type = (string) $row->normalized_client_type;
            if (!isset($uaTopMap[$type]) || (int) $row->count_30d > $uaTopMap[$type]['count']) {
                $uaTopMap[$type] = [
                    'ua' => (string) $row->user_agent,
                    'count' => (int) $row->count_30d,
                ];
            }
        }

        $uaStatMap = [];
        foreach ($uaStatRows as $row) {
            $type = (string) $row->normalized_client_type;
            $ua = trim((string) $row->user_agent);
            if (!$ua) {
                continue;
            }
            if (!isset($uaStatMap[$type])) {
                $uaStatMap[$type] = [];
            }
            $uaStatMap[$type][] = [
                'ua' => $ua,
                'count_24h' => (int) $row->count_24h,
                'count_30d' => (int) $row->count_30d,
            ];
        }

        return $items->map(function ($item) use ($flag24hMap, $flag30dMap, $ua24hMap, $ua30dMap, $uaTopMap, $uaStatMap) {
            $type = strtolower(trim((string) ($item['client_type'] ?? '')));
            $item['subscribe_flag_count_24h'] = $flag24hMap[$type] ?? 0;
            $item['subscribe_flag_count_30d'] = $flag30dMap[$type] ?? 0;
            $item['subscribe_ua_unique_count_24h'] = $ua24hMap[$type] ?? 0;
            $item['subscribe_ua_unique_count_30d'] = $ua30dMap[$type] ?? 0;
            $item['top_raw_ua'] = $uaTopMap[$type]['ua'] ?? '';
            $item['top_raw_ua_count'] = $uaTopMap[$type]['count'] ?? 0;
            $item['raw_ua_stats'] = $uaStatMap[$type] ?? [];
            $item['raw_ua_list'] = array_column($item['raw_ua_stats'], 'ua');
            return $item;
        });
    }


    public function getBlacklists(Request $request)
    {
        return response([
            'data' => (new RiskBlacklistService())->fetch()
        ]);
    }

    public function updateBlacklist(Request $request)
    {
        $rawItems = $request->input('items');
        if (is_null($rawItems)) {
            $rawItems = [$request->all()];
        }
        if (!is_array($rawItems)) {
            abort(422, 'items must be an array');
        }

        $items = [];
        foreach ($rawItems as $item) {
            if (!is_array($item)) {
                abort(422, 'each item must be an object');
            }
            if (empty($item['type']) || !is_string($item['type'])) {
                abort(422, 'type is required');
            }
            if (empty($item['value']) || !is_string($item['value'])) {
                abort(422, 'value is required');
            }
            if (array_key_exists('remark', $item) && !is_null($item['remark']) && !is_string($item['remark'])) {
                abort(422, 'remark must be string');
            }
            if (array_key_exists('ua_raw', $item) && !is_null($item['ua_raw']) && !is_string($item['ua_raw'])) {
                abort(422, 'ua_raw must be string');
            }
            if (array_key_exists('is_enabled', $item)) {
                $enabled = filter_var($item['is_enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if (is_null($enabled)) {
                    abort(422, 'is_enabled must be boolean');
                }
                $item['is_enabled'] = $enabled;
            }
            $item['type'] = strtolower($item['type']);
            $items[] = $item;
        }

        return response([
            'data' => (new RiskBlacklistService())->save($items)
        ]);
    }

    public function deleteBlacklist(Request $request)
    {
        $id = (string) $request->input('id', '');
        if (!$id) {
            abort(422, 'id is required');
        }

        return response([
            'data' => (new RiskBlacklistService())->delete($id)
        ]);
    }

    public function getRuleHits(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 10), 1), 100);

        $builder = RiskRuleHit::query();
        if ($request->filled('scene')) {
            $builder->where('scene', $request->input('scene'));
        }
        if ($request->filled('rule_key')) {
            $builder->where('rule_key', $request->input('rule_key'));
        }
        if ($request->filled('email')) {
            $builder->where('email', 'like', '%' . $request->input('email') . '%');
        }
        if ($request->filled('ip')) {
            $builder->where('ip', $request->input('ip'));
        }

        $total = $builder->count();
        $data = $builder->orderBy('id', 'desc')
            ->forPage($current, $pageSize)
            ->get();

        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }


    public function getOnlineUsers(Request $request)
    {
        $since = time() - 600;
        $users = User::query()
            ->where('t', '>=', $since)
            ->select(['id', 'email', 't'])
            ->orderBy('t', 'desc')
            ->limit(1000)
            ->get();

        $geoIpService = new GeoIpService();
        $rows = [];
        foreach ($users as $user) {
            $ipsArray = Cache::get('ALIVE_IP_USER_' . $user->id) ?? [];
            $onlineIps = [];
            foreach ($ipsArray as $nodeTypeId => $data) {
                if (!is_int($data) && isset($data['aliveips']) && is_array($data['aliveips'])) {
                    foreach ($data['aliveips'] as $ipNodeId) {
                        $ip = explode('_', (string) $ipNodeId)[0] ?? '';
                        if ($ip) {
                            $onlineIps[] = [
                                'ip' => $ip,
                                'node' => (string) $nodeTypeId,
                            ];
                        }
                    }
                }
            }

            if (empty($onlineIps)) {
                continue;
            }

            foreach ($onlineIps as $item) {
                $geo = $geoIpService->lookup($item['ip']);
                $rows[] = [
                    'user_id' => $user->id,
                    'email' => $user->email,
                    'online_ip' => $item['ip'],
                    'node' => $item['node'],
                    'alive_count' => (int) ($ipsArray['alive_ip'] ?? count($onlineIps)),
                    'online_at' => (int) $user->t,
                    'country' => $geo['country'] ?? null,
                    'region' => $geo['region'] ?? null,
                    'city' => $geo['city'] ?? null,
                    'asn' => $geo['asn'] ?? null,
                    'isp' => $geo['isp'] ?? null,
                ];
            }
        }

        return response([
            'data' => $rows,
            'total' => count($rows),
        ]);
    }

    public function getUserUsage(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 50), 1), 200);

        $userBuilder = User::query();
        if ($request->filled('email')) {
            $userBuilder->where('email', 'like', '%' . $request->input('email') . '%');
        }

        $total = $userBuilder->count();
        $users = $userBuilder->orderBy('id', 'desc')
            ->forPage($current, $pageSize)
            ->get([
                'id',
                'email',
                'token',
                'created_at',
                't',
                'last_login_at',
                'last_login_ip',
                'expired_at',
                'plan_id',
                'group_id',
                'balance',
            ]);

        if ($users->isEmpty()) {
            return response([
                'data' => [],
                'total' => $total,
            ]);
        }

        $userIds = $users->pluck('id')->toArray();

        $planNames = Plan::query()
            ->whereIn('id', array_values(array_filter($users->pluck('plan_id')->unique()->toArray())))
            ->pluck('name', 'id')
            ->toArray();

        $groupNames = ServerGroup::query()
            ->whereIn('id', array_values(array_filter($users->pluck('group_id')->unique()->toArray())))
            ->pluck('name', 'id')
            ->toArray();

        $latestSubscribeMap = [];
        $subscribeLogs = SubscribeLog::query()
            ->whereIn('user_id', $userIds)
            ->orderBy('id', 'desc')
            ->get(['user_id', 'created_at', 'ip', 'user_agent']);
        foreach ($subscribeLogs as $log) {
            if (!isset($latestSubscribeMap[$log->user_id])) {
                $latestSubscribeMap[$log->user_id] = $log;
            }
        }

        $orderStatsMap = [];
        $orderStats = Order::query()
            ->whereIn('user_id', $userIds)
            ->where('status', 3)
            ->selectRaw('user_id, COUNT(*) as paid_order_count, COALESCE(SUM(total_amount), 0) as paid_total_amount')
            ->groupBy('user_id')
            ->get();
        foreach ($orderStats as $item) {
            $orderStatsMap[$item->user_id] = [
                'paid_order_count' => (int) $item->paid_order_count,
                'paid_total_amount' => (int) $item->paid_total_amount,
            ];
        }

        $latestOnlineMap = UserOnlineSnapshot::query()
            ->whereIn('user_id', $userIds)
            ->orderBy('online_at', 'desc')
            ->get(['user_id', 'online_at', 'ip', 'node'])
            ->keyBy('user_id');

        $rows = [];
        foreach ($users as $user) {
            $latestSubscribe = $latestSubscribeMap[$user->id] ?? null;
            $orderStat = $orderStatsMap[$user->id] ?? [
                'paid_order_count' => 0,
                'paid_total_amount' => 0,
            ];
            $latestOnline = $latestOnlineMap[$user->id] ?? null;

            $rows[] = [
                'user_id' => $user->id,
                'email' => $user->email,
                'register_at' => (int) ($user->created_at ?? 0),
                'last_subscribe_at' => $latestSubscribe ? (int) $latestSubscribe->created_at : null,
                'last_subscribe_ip' => $latestSubscribe ? $this->formatIp($latestSubscribe->ip) : null,
                'last_subscribe_ua' => $latestSubscribe ? (string) ($latestSubscribe->user_agent ?? '') : null,
                'last_online_at' => $latestOnline ? (int) $latestOnline->online_at : null,
                'last_online_ip' => $latestOnline ? $this->formatIp($latestOnline->ip) : null,
                'last_online_node' => $latestOnline ? $latestOnline->node : null,
                'last_login_at' => $user->getRawOriginal('last_login_at') ? (int) $user->getRawOriginal('last_login_at') : null,
                'last_login_ip' => $this->formatIp($user->getRawOriginal('last_login_ip')),
                'subscription_plan' => $planNames[$user->plan_id] ?? null,
                'group_name' => $groupNames[$user->group_id] ?? null,
                'recharge_total' => round($orderStat['paid_total_amount'] / 100, 2),
                'balance' => round(((int) $user->balance) / 100, 2),
                'expired_at' => $user->expired_at ? (int) $user->expired_at : null,
            ];
        }

        return response([
            'data' => $rows,
            'total' => $total,
        ]);
    }

    public function getLoginLogs(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 10), 1), 100);

        $builder = LoginLog::query();
        if ($request->filled('email')) {
            $builder->where('email', 'like', '%' . $request->input('email') . '%');
        }
        if ($request->filled('ip')) {
            $builder->where('ip', $request->input('ip'));
        }
        if ($request->has('is_success') && $request->input('is_success') !== '') {
            $builder->where('is_success', (int)$request->input('is_success'));
        }

        $total = $builder->count();
        $data = $builder->orderBy('id', 'desc')
            ->forPage($current, $pageSize)
            ->get();

        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }

    public function getUserConnectionLogs(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 50), 1), 200);

        $retentionDays = $this->getConnectionLogRetentionDays();
        $minConnectedAt = time() - ($retentionDays * 86400);

        $builder = UserConnectionLog::query()->where('connected_at', '>=', $minConnectedAt);
        if ($request->filled('user_id')) {
            $builder->where('user_id', (int) $request->input('user_id'));
        }
        if ($request->filled('ip')) {
            $builder->where('ip', $request->input('ip'));
        }

        $total = $builder->count();
        $data = $builder->orderBy('connected_at', 'desc')
            ->forPage($current, $pageSize)
            ->get();

        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }

    public function getSubscribeLogs(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 10), 1), 100);

        $builder = SubscribeLog::query();
        if ($request->filled('email')) {
            $builder->where('email', 'like', '%' . $request->input('email') . '%');
        }
        if ($request->filled('ip')) {
            $builder->where('ip', $request->input('ip'));
        }
        if ($request->filled('client_type')) {
            $builder->where('client_type', 'like', '%' . $request->input('client_type') . '%');
        }
        if ($request->filled('status')) {
            $builder->where('status', $request->input('status'));
        }

        $total = $builder->count();
        $data = $builder->orderBy('id', 'desc')
            ->forPage($current, $pageSize)
            ->get();

        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }

    public function getRiskSettings(Request $request)
    {
        $rows = RiskSetting::query()->whereIn('key', ['connection_log_interval', 'connection_log_retention_days'])->get()->keyBy('key');
        return response([
            'data' => [
                'connection_log_interval' => (int) ($rows['connection_log_interval']->value ?? 3600),
                'connection_log_retention_days' => (int) ($rows['connection_log_retention_days']->value ?? 30),
            ]
        ]);
    }

    public function updateRiskSettings(Request $request)
    {
        $interval = (int) $request->input('connection_log_interval', 3600);
        if ($interval < 60 || $interval > 86400) {
            abort(422, 'connection_log_interval must be between 60 and 86400 seconds');
        }

        $retentionDays = (int) $request->input('connection_log_retention_days', 30);
        if ($retentionDays < 1 || $retentionDays > 365) {
            abort(422, 'connection_log_retention_days must be between 1 and 365 days');
        }

        RiskSetting::query()->updateOrCreate(
            ['key' => 'connection_log_interval'],
            ['value' => (string) $interval]
        );
        RiskSetting::query()->updateOrCreate(
            ['key' => 'connection_log_retention_days'],
            ['value' => (string) $retentionDays]
        );
        Cache::forget('RISK_CONNECTION_LOG_INTERVAL');
        Cache::forget('RISK_CONNECTION_LOG_RETENTION_DAYS');

        return response([
            'data' => [
                'connection_log_interval' => $interval,
                'connection_log_retention_days' => $retentionDays,
            ]
        ]);
    }


    private function getConnectionLogRetentionDays(): int
    {
        return (int) Cache::remember('RISK_CONNECTION_LOG_RETENTION_DAYS', 60, function () {
            $raw = RiskSetting::query()->where('key', 'connection_log_retention_days')->value('value');
            $value = (int) $raw;
            if ($value < 1) {
                $value = 30;
            }
            return min($value, 365);
        });
    }

    private function percent(int $total, int $sub): string
    {
        if ($total <= 0) {
            return '0%';
        }

        return round(($sub / $total) * 100, 2) . '%';
    }

    private function formatIp($ip): ?string
    {
        if (is_null($ip) || $ip === '') {
            return null;
        }

        if (is_numeric($ip) && strpos((string) $ip, '.') === false && strpos((string) $ip, ':') === false) {
            $converted = long2ip((int) $ip);
            return $converted ?: (string) $ip;
        }

        return (string) $ip;
    }
}
