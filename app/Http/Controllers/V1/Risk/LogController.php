<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\RiskRuleHit;
use App\Models\SubscribeLog;
use App\Services\RiskLogService;
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
