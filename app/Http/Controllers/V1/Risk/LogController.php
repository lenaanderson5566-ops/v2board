<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\RiskRuleHit;
use App\Models\RiskRuleConfig;
use App\Models\SubscribeLog;
use App\Services\RiskLogService;
use App\Services\ClientStrategyService;
use App\Services\RiskBlacklistService;
use Illuminate\Http\Request;

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

        RiskRuleConfig::updateOrCreate(
            ['rule_key' => $ruleKey],
            [
                'scene' => $default['scene'],
                'name' => $params['name'] ?? $default['name'],
                'description' => array_key_exists('description', $params) ? $params['description'] : $default['description'],
                'risk_level' => $params['risk_level'] ?? $default['risk_level'],
                'thresholds' => is_null($thresholds) ? $default['thresholds'] : array_merge($default['thresholds'], $thresholds),
                'enabled' => array_key_exists('enabled', $params) ? (int) (bool) $params['enabled'] : 1,
                'sort' => $params['sort'] ?? $default['sort'],
            ]
        );

        return response([
            'data' => (new RiskLogService())->getRuleDefinitions()
        ]);
    }


    public function getClientStrategies(Request $request)
    {
        return response([
            'data' => (new ClientStrategyService())->getStrategies()
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

        return response([
            'data' => (new ClientStrategyService())->updateStrategies($items)
        ]);
    }


    public function deleteClientStrategy(Request $request)
    {
        $clientType = strtolower((string) $request->input('client_type', ''));
        if (!$clientType) {
            abort(422, 'client_type is required');
        }

        (new ClientStrategyService())->deleteStrategy($clientType);

        return response([
            'data' => (new ClientStrategyService())->getStrategies()
        ]);
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

    private function percent(int $total, int $sub): string
    {
        if ($total <= 0) {
            return '0%';
        }

        return round(($sub / $total) * 100, 2) . '%';
    }
}
