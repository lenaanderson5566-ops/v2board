<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\RiskRuleHit;
use App\Models\RiskRuleConfig;
use App\Models\SubscribeLog;
use App\Models\User;
use App\Models\Plan;
use App\Models\UserConnectionLog;
use App\Models\UserOnlineSnapshot;
use App\Models\RiskSetting;
use App\Services\AdminRecurringOrderHistory;
use App\Services\RiskLogService;
use App\Services\RiskStatisticsService;
use App\Services\GeoIpService;
use App\Services\TrafficCreditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class LogController extends Controller
{
    public function getSummary(Request $request)
    {
        $params = $request->validate(['window' => 'nullable|in:today,7d,30d', 'view' => 'sometimes|in:dashboard']);
        return response(['data' => app(RiskStatisticsService::class)->dashboard($params['window'] ?? 'today')]);
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
        if ($request->boolean('review_queue')) {
            app(RiskStatisticsService::class)->pendingReview($builder, time());
            $total = $builder->count();
            $data = $builder->orderBy('hit_at')->orderBy('id')->forPage($current, $pageSize)->get();
            $this->decorateLogRows($data);
            return response(['data' => $data, 'total' => $total]);
        }
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
                $event = $events->get($row->id);
                $row->payload = $event?->payload ?? [];
                $row->reason = $event?->reason;
                $row->client_type = $event?->client_type;
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

        $rows = [];
        $users->chunkById(200, function ($users) use (&$rows, $now) {
            $states = \App\Services\OnlineDeviceService::forUsers($users->pluck('id')->all(), $now);
            foreach ($users as $user) {
                $state = $states[$user->id];
                foreach ($state['connections'] as $item) {
                    $rows[$user->id . '|' . $item['ip'] . '|' . $item['node']] = [
                        'user_id' => $user->id,
                        'email' => $user->email,
                        'online_ip' => $item['ip'],
                        'ip' => $item['ip'],
                        'node' => $item['node'],
                        'alive_count' => $state['count'],
                        'online_at' => $item['online_at'],
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
        $visible = $page - 1 > intdiv(max(0, $total - 1), $size)
            ? [] : array_slice($rows, ($page - 1) * $size, $size);
        $geoIpService = new GeoIpService();
        $locations = [];
        foreach ($visible as &$row) {
            $geo = $locations[$row['ip']] ??= $geoIpService->lookup($row['ip']);
            foreach (['country', 'region', 'city', 'asn', 'isp'] as $field) {
                $row[$field] = $geo[$field] ?? null;
            }
        }
        unset($row);
        return response([
            'data' => $visible,
            'total' => $total,
            'meta' => ['users' => count(array_unique(array_column($rows, 'user_id'))),
                'ips' => count(array_unique(array_column($rows, 'ip'))), 'connections' => $total,
                'updated_at' => time()],
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
        $user = User::query()->find($id, [
            'id', 'email', 'expired_at', 'banned', 'u', 'd', 'transfer_enable', 'credit_balance', 'plan_id',
        ]);
        if ($user) {
            AdminRecurringOrderHistory::append(collect([$user]));
            $user['current_plan_name'] = $user->plan_id && $user->expired_at !== null && TrafficCreditService::hasPeriod($user)
                ? Plan::query()->whereKey($user->plan_id)->value('name')
                : null;
            $user->makeHidden('plan_id');
        }
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
