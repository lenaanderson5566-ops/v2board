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
use App\Services\RiskStatisticsService;
use App\Services\ClientStrategyService;
use App\Services\RiskBlacklistService;
use App\Services\GeoIpService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LogController extends Controller
{
    public function getSummary(Request $request)
    {
        $params = $request->validate(['window' => 'nullable|in:today,7d,30d']);

        return response(['data' => app(RiskStatisticsService::class)->summary($params['window'] ?? 'today')]);
    }

    public function getOverview(Request $request)
    {
        return response(['data' => app(RiskStatisticsService::class)->overview()]);
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
            $thresholds = $this->normalizeRuleThresholds($default['thresholds'], $thresholds);
        }

        $mergedExistingThresholds = $thresholds ?? $this->normalizeRuleThresholds(
            $default['thresholds'],
            ($existing && is_array($existing->thresholds)) ? $existing->thresholds : []
        );

        $enabled = null;
        if (array_key_exists('enabled', $params)) {
            $enabled = filter_var($params['enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if (is_null($enabled)) {
                abort(422, 'enabled must be boolean');
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
                    ? $mergedExistingThresholds
                    : $thresholds,
                'enabled' => !is_null($enabled)
                    ? (int) $enabled
                    : (($existing && !is_null($existing->enabled)) ? (int) $existing->enabled : 1),
                'sort' => $params['sort'] ?? ($existing->sort ?? $default['sort']),
            ]
        );

        RiskLogService::clearRuleCache();
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

        RiskLogService::clearRuleCache();
        return response([
            'data' => (new RiskLogService())->getRuleDefinitions()
        ]);
    }

    public function getClientStrategies(Request $request)
    {
        $strategies = (new ClientStrategyService())->getStrategies();

        return response([
            'data' => app(RiskStatisticsService::class)->clientSubscriptionStats($strategies)
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
            'data' => app(RiskStatisticsService::class)->clientSubscriptionStats($strategies)
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
            'data' => app(RiskStatisticsService::class)->clientSubscriptionStats($strategies)
        ]);
    }



    public function getIpBlacklists(Request $request)
    {
        return response([
            'data' => $this->fetchBlacklistsByType('ip')
        ]);
    }

    public function getUaBlacklists(Request $request)
    {
        return response([
            'data' => $this->fetchBlacklistsByType('ua_hash')
        ]);
    }

    public function updateIpBlacklist(Request $request)
    {
        return $this->handleBlacklistUpdate($request, 'ip');
    }

    public function updateUaBlacklist(Request $request)
    {
        return $this->handleBlacklistUpdate($request, 'ua_hash');
    }

    public function deleteIpBlacklist(Request $request)
    {
        return $this->handleBlacklistDelete($request, 'ip:');
    }

    public function deleteUaBlacklist(Request $request)
    {
        return $this->handleBlacklistDelete($request, 'ua_hash:');
    }

    private function fetchBlacklistsByType(string $type)
    {
        $rows = (new RiskBlacklistService())->fetch($type);
        return collect($rows)->values();
    }

    private function handleBlacklistUpdate(Request $request, string $forceType)
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
            $item['type'] = $forceType;
            if (array_key_exists('value', $item) && !is_null($item['value']) && !is_string($item['value'])) {
                abort(422, 'value must be string');
            }
            if (!array_key_exists('value', $item)) {
                $item['value'] = '';
            }
            if (array_key_exists('remark', $item) && !is_null($item['remark']) && !is_string($item['remark'])) {
                abort(422, 'remark must be string');
            }
            if (array_key_exists('ua_raw', $item) && !is_null($item['ua_raw']) && !is_string($item['ua_raw'])) {
                abort(422, 'ua_raw must be string');
            }
            if ($item['type'] === 'ua_hash' && empty(trim((string) $item['value'])) && empty(trim((string) ($item['ua_raw'] ?? '')))) {
                abort(422, 'ua_raw is required when value is empty');
            }
            if ($item['type'] === 'ip' && empty(trim((string) $item['value']))) {
                abort(422, 'value is required');
            }
            if (array_key_exists('is_enabled', $item)) {
                $enabled = filter_var($item['is_enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if (is_null($enabled)) {
                    abort(422, 'is_enabled must be boolean');
                }
                $item['is_enabled'] = $enabled;
            }
            $items[] = $item;
        }

        return response([
            'data' => (new RiskBlacklistService())->save($items)
        ]);
    }

    private function handleBlacklistDelete(Request $request, string $prefix)
    {
        $id = (string) $request->input('id', '');
        if (!$id) {
            abort(422, 'id is required');
        }
        if (strpos($id, $prefix) !== 0) {
            abort(422, "id must be {$prefix}*");
        }

        return response([
            'data' => (new RiskBlacklistService())->delete($id)
        ]);
    }

    public function reviewRuleHit(Request $request)
    {
        $p = $request->validate(['id' => 'required|integer|min:1','state' => 'required|in:pending,confirmed,false_positive,ignored','note' => 'nullable|string|max:1000']);
        app(RiskLogService::class)->reviewHit($p, $request->user['id'] ?? null);
        return response(['data' => true]);
    }

    public function getRuleHits(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 10), 1), 100);

        $builder = RiskRuleHit::query();
        $this->filterLogSearch($request, $builder, ['email', 'ip', 'rule_key', 'status', 'scene'], 'hit_at');
        if ($request->filled('scene')) {
            $builder->where('scene', $request->input('scene'));
        }
        if ($request->filled('rule_key')) {
            $builder->where('rule_key', $request->input('rule_key'));
        }
        if ($request->filled('risk_level')) {
            $builder->where('risk_level', $request->input('risk_level'));
        }
        if ($request->filled('email')) {
            $builder->where('email', 'like', '%' . $request->input('email') . '%');
        }
        if ($request->filled('ip')) {
            $builder->where('ip', $request->input('ip'));
        }

        if ($request->boolean('grouped')) {
            // Preserve raw events; group only the display within fixed ten-minute windows.
            $builder->where('hit_at', '>=', time() - 30 * 86400);
            $grouped = $builder->select(['user_id', 'email', 'rule_key', 'ip', 'status', 'risk_level', 'scene'])
                ->selectRaw('MAX(id) as id, COUNT(*) as hit_count, MIN(hit_at) as first_hit_at, MAX(hit_at) as hit_at, FLOOR(hit_at / 600) as time_bucket')
                ->groupBy('user_id', 'email', 'rule_key', 'ip', 'status', 'risk_level', 'scene', 'time_bucket');
            $total = DB::query()->fromSub(clone $grouped, 'events')->count();
            $data = $grouped->orderByDesc('hit_at')->orderByDesc('id')->forPage($current, $pageSize)->get();
            $events = RiskRuleHit::query()->whereIn('id', $data->pluck('id'))->get()->keyBy('id');
            foreach ($data as $row) {
                $row->payload = $events->get($row->id)->payload ?? [];
            }
            $this->decorateLogRows($data);
            return response(['data' => $data,'total' => $total]);
        }
        $total = $builder->count();
        $data = $builder->orderBy('id', 'desc')
            ->forPage($current, $pageSize)
            ->get();

        $this->decorateLogRows($data);
        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }

    public function getOnlineUsers(Request $request)
    {
        $now = time();
        $since = $now - \App\Services\OnlineDeviceService::freshWindow();
        $users = User::query()
            ->whereIn('id', UserOnlineSnapshot::query()->select('user_id')->where('source', 'alive')->where('online_at', '>', $since))
            ->select(['id', 'email'])
            ->when($request->filled('email'), function ($q) use ($request) {
                $q->where('email', 'like', '%' . $request->input('email') . '%');
            });

        $geoIpService = new GeoIpService();
        $rows = [];
        $users->chunkById(200, function ($users) use (&$rows, $now, $geoIpService) {
            $states = \App\Services\OnlineDeviceService::forUsers($users->pluck('id')->all(), $now);
            foreach ($users as $user) {
                $state = $states[$user->id];
                foreach ($state['connections'] as $item) {
                    $geo = $geoIpService->lookup($item['ip']);
                    $rows[$user->id . '|' . $item['ip'] . '|' . $item['node']] = [
                        'user_id' => $user->id,
                        'email' => $user->email,
                        'online_ip' => $item['ip'],
                        'ip' => $item['ip'],
                        'node' => $item['node'],
                        'alive_count' => $state['count'],
                        'online_at' => $item['online_at'],
                        'country' => $geo['country'] ?? null,
                        'region' => $geo['region'] ?? null,
                        'city' => $geo['city'] ?? null,
                        'asn' => $geo['asn'] ?? null,
                        'isp' => $geo['isp'] ?? null,
                    ];
                }
            }
        });

        $rows = array_values($rows);
        usort($rows, fn($a, $b) => $b['online_at'] <=> $a['online_at'] ?: $a['user_id'] <=> $b['user_id']
            ?: strcmp($a['node'], $b['node']) ?: strcmp($a['ip'], $b['ip']));
        $total = count($rows);
        $page = max(1, (int) $request->input('current', 1));
        $size = min(200, max(1, (int) $request->input('page_size', 20)));
        return response([
            'data' => array_slice($rows, ($page - 1) * $size, $size),
            'total' => $total,
            'meta' => ['users' => count(array_unique(array_column($rows, 'user_id'))),
                'ips' => count(array_unique(array_column($rows, 'ip'))), 'connections' => $total,
                'updated_at' => time()],
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
            ->whereIn('id', SubscribeLog::query()->whereIn('user_id', $userIds)->selectRaw('MAX(id)')->groupBy('user_id'))
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
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')->from('v2_user_online_snapshot as newer')
                    ->whereColumn('newer.user_id', 'v2_user_online_snapshot.user_id')
                    ->where(function ($q) {
                        $q->whereColumn('newer.online_at', '>', 'v2_user_online_snapshot.online_at')
                          ->orWhere(function ($tie) {
                              $tie->whereColumn('newer.online_at', 'v2_user_online_snapshot.online_at')->whereColumn('newer.id', '>', 'v2_user_online_snapshot.id');
                          });
                    });
            })
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
                'paid_total_amount' => $orderStat['paid_total_amount'],
                'balance' => round(((int) $user->balance) / 100, 2),
                'balance_cents' => (int) $user->balance,
                'expired_at' => $user->expired_at ? (int) $user->expired_at : null,
            ];
        }

        return response([
            'data' => $rows,
            'total' => $total,
        ]);
    }

    private function decorateLogRows($rows): void
    {
        $geo = new GeoIpService();
        $cache = [];
        foreach ($rows as $row) {
            $ip = $this->formatIp($row->ip);
            $row->ip = $ip;
            $location = $cache[$ip] ??= $geo->lookup($ip);
            foreach ($location as $key => $value) {
                if (empty($row->$key)) {
                    $row->$key = $value;
                }
            }
            if (!empty($row->user_agent)) {
                $row->recognized_client = app(\App\Services\ClientRecognition::class)->identify((string)$row->user_agent);
            }
            if ($row->rule_key) {
                $row->rule_name = RiskLogService::ruleName($row->rule_key);
            }
        }
    }

    private function filterLogSearch(Request $request, $builder, array $columns, string $timeColumn, bool $relatedEmail = false): void
    {
        $params = $request->validate([
            'keyword' => 'nullable|string|max:200',
            'from' => 'nullable|integer|min:0',
            'to' => 'nullable|integer|min:0',
        ]);
        if (isset($params['from'], $params['to']) && $params['to'] < $params['from']) {
            abort(422, '结束时间不能早于开始时间');
        }
        foreach (['from' => '>=', 'to' => '<='] as $key => $operator) {
            if (isset($params[$key])) {
                $builder->where($timeColumn, $operator, $params[$key]);
            }
        }
        $keyword = trim($params['keyword'] ?? '');
        if ($keyword === '') {
            return;
        }
        $builder->where(function ($query) use ($keyword, $columns, $relatedEmail) {
            foreach ($columns as $column) {
                $query->orWhere($column, 'like', '%' . $keyword . '%');
            }
            if (ctype_digit($keyword)) {
                $query->orWhere('user_id', (int) $keyword);
            }
            if ($relatedEmail) {
                $query->orWhereIn('user_id', User::query()->select('id')->where('email', 'like', '%' . $keyword . '%'));
            }
        });
    }

    public function getLoginLogs(Request $request)
    {
        $current = max((int)$request->input('current', 1), 1);
        $pageSize = min(max((int)$request->input('page_size', 10), 1), 100);

        $builder = LoginLog::query();
        $this->filterLogSearch($request, $builder, ['email', 'ip', 'user_agent'], 'created_at');
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

        $this->decorateLogRows($data);
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
        $this->filterLogSearch($request, $builder, ['ip'], 'connected_at', true);
        if ($request->filled('email')) {
            $builder->whereIn('user_id', User::query()->select('id')
                ->where('email', 'like', '%' . trim((string) $request->input('email')) . '%'));
        }
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

        $emails = User::query()->whereIn('id', $data->pluck('user_id')->unique())->pluck('email', 'id');
        $data->each(function ($row) use ($emails) {
            $row->setAttribute('email', $emails->get($row->user_id));
        });

        $this->decorateLogRows($data);
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
        $this->filterLogSearch($request, $builder, ['email', 'ip', 'user_agent', 'client_type', 'status', 'reason'], 'created_at');
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

        $this->decorateLogRows($data);
        return response([
            'data' => $data,
            'total' => $total,
        ]);
    }

    public function getUserActivity(Request $request)
    {
        $params = $request->validate(['user_id' => 'required|integer|min:1']);
        $id = $params['user_id'];
        $user = User::query()->find($id, ['id', 'email', 'expired_at', 'banned', 'u', 'd', 'credit_balance']);
        $events = collect();
        foreach ([[LoginLog::class, 'created_at', '登录'], [SubscribeLog::class, 'created_at', '订阅'],
            [UserConnectionLog::class, 'connected_at', '连接'], [RiskRuleHit::class, 'hit_at', '风控']] as [$model, $time, $kind]) {
            $columns = ['id', 'user_id', 'ip', $time];
            if ($kind === '风控') {
                $columns = array_merge($columns, ['rule_key', 'risk_level', 'status', 'payload', 'reason']);
            }
            if ($kind === '登录') {
                $columns = array_merge($columns, ['is_success', 'reason', 'user_agent']);
            }
            if ($kind === '订阅') {
                $columns = array_merge($columns, ['client_type', 'status', 'reason', 'user_agent', 'traffic_u', 'traffic_d']);
            }
            if ($kind === '连接') {
                $columns[] = 'node';
            }
            foreach ($model::query()->where('user_id', $id)->orderByDesc($time)->orderByDesc('id')->limit(50)->get($columns) as $row) {
                $event = $row->toArray();
                $event['at'] = (int) $row->getRawOriginal($time);
                $event['kind'] = $kind;
                $event['ip'] = $this->formatIp($row->ip);
                $event = array_merge($event, (new GeoIpService())->lookup($event['ip']));
                if (isset($event['rule_key'])) {
                    $event['rule_name'] = RiskLogService::ruleName($event['rule_key']);
                }
                if (!empty($event['user_agent'])) {
                    $event['recognized_client'] = app(\App\Services\ClientRecognition::class)->identify($event['user_agent']);
                }
                $events->push($event);
            }
        }
        return response(['data' => ['user' => $user, 'events' => $events->sortByDesc('at')->values(), 'limit_per_type' => 50]]);
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
        $params = $request->validate([
            'connection_log_interval' => 'required|integer|between:60,86400',
            'connection_log_retention_days' => 'required|integer|between:1,365',
        ]);
        $interval = (int) $params['connection_log_interval'];
        if ($interval < 60 || $interval > 86400) {
            abort(422, 'connection_log_interval must be between 60 and 86400 seconds');
        }

        $retentionDays = (int) $params['connection_log_retention_days'];
        if ($retentionDays < 1 || $retentionDays > 365) {
            abort(422, 'connection_log_retention_days must be between 1 and 365 days');
        }

        DB::transaction(function () use ($interval, $retentionDays) {
            RiskSetting::query()->updateOrCreate(
                ['key' => 'connection_log_interval'],
                ['value' => (string) $interval]
            );
            RiskSetting::query()->updateOrCreate(
                ['key' => 'connection_log_retention_days'],
                ['value' => (string) $retentionDays]
            );
        });
        Cache::forget('RISK_CONNECTION_LOG_INTERVAL');
        Cache::forget('RISK_CONNECTION_LOG_RETENTION_DAYS');

        return response([
            'data' => [
                'connection_log_interval' => $interval,
                'connection_log_retention_days' => $retentionDays,
            ]
        ]);
    }


    private function normalizeRuleThresholds(array $defaultThresholds, array $thresholds): array
    {
        $allowedThresholdKeys = array_keys($defaultThresholds);
        $normalized = [];

        foreach ($thresholds as $thresholdKey => $thresholdValue) {
            if (!in_array($thresholdKey, $allowedThresholdKeys, true)) {
                abort(422, 'thresholds contains unknown key: ' . $thresholdKey);
            }
            if (filter_var($thresholdValue, FILTER_VALIDATE_INT) === false) {
                abort(422, 'thresholds.' . $thresholdKey . ' must be integer');
            }

            $thresholdValue = (int) $thresholdValue;
            if ($thresholdKey === 'window_seconds' && ($thresholdValue < 60 || $thresholdValue > 2592000)) {
                abort(422, '统计窗口须为 60 至 2592000 秒');
            }
            if (in_array($thresholdKey, ['threshold', 'subscribe_threshold'], true) && $thresholdValue < 1) {
                abort(422, '命中阈值至少为 1');
            }
            if ($thresholdValue < 0) {
                abort(422, 'thresholds.' . $thresholdKey . ' must be >= 0');
            }

            $normalized[$thresholdKey] = $thresholdValue;
        }

        return array_merge($defaultThresholds, $normalized);
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
