<?php

namespace App\Services;

use App\Models\LoginLog;
use App\Models\RiskRuleHit;
use App\Models\SubscribeLog;

class RiskLogService
{
    public function createLoginLog(array $payload): void
    {
        $ip = $payload['ip'] ?? request()->ip();
        $geo = (new GeoIpService())->lookup($ip);

        $log = LoginLog::create(array_merge([
            'user_id' => null,
            'email' => null,
            'ip' => $ip,
            'login_domain' => request()->getHost(),
            'user_agent' => request()->header('user-agent'),
            'is_success' => false,
            'reason' => null,
        ], $geo, $payload));

        $this->evaluateLoginRules($log);
    }

    public function createSubscribeLog(array $payload): void
    {
        $ip = $payload['ip'] ?? request()->ip();
        $userAgent = $payload['user_agent'] ?? request()->header('user-agent');
        $geo = (new GeoIpService())->lookup($ip);

        $log = SubscribeLog::create(array_merge([
            'user_id' => null,
            'email' => null,
            'plan_id' => null,
            'plan_name' => null,
            'expired_at' => null,
            'client_type' => null,
            'traffic_u' => null,
            'traffic_d' => null,
            'traffic_total' => null,
            'ip' => $ip,
            'subscribe_domain' => request()->getHost(),
            'user_agent' => $userAgent,
            'ua_hash' => $userAgent ? hash('sha256', $userAgent) : null,
            'status' => 'failed',
            'reason' => null,
        ], $geo, $payload));

        $this->evaluateSubscribeRules($log);
    }

    private function evaluateLoginRules(LoginLog $log): void
    {
        $now = time();

        if ((int) $log->is_success === 0) {
            $failedByIpIn10m = LoginLog::query()
                ->where('ip', $log->ip)
                ->where('is_success', 0)
                ->where('created_at', '>=', $now - 600)
                ->count();

            if ($failedByIpIn10m >= 5) {
                $this->recordRuleHit('login', 'login_failed_burst_by_ip_10m', 'high', $log, [
                    'threshold' => 5,
                    'window_seconds' => 600,
                    'failed_count' => $failedByIpIn10m,
                ]);
            }
        }

        if (!empty($log->email)) {
            $distinctIpIn1h = LoginLog::query()
                ->where('email', $log->email)
                ->where('created_at', '>=', $now - 3600)
                ->distinct('ip')
                ->count('ip');

            if ($distinctIpIn1h >= 5) {
                $this->recordRuleHit('login', 'login_account_multi_ip_1h', 'medium', $log, [
                    'threshold' => 5,
                    'window_seconds' => 3600,
                    'distinct_ip_count' => $distinctIpIn1h,
                ]);
            }
        }
    }

    private function evaluateSubscribeRules(SubscribeLog $log): void
    {
        $now = time();

        if (!empty($log->user_id)) {
            $subscribeByUserIn10m = SubscribeLog::query()
                ->where('user_id', $log->user_id)
                ->where('created_at', '>=', $now - 600)
                ->count();

            if ($subscribeByUserIn10m >= 20) {
                $this->recordRuleHit('subscribe', 'subscribe_high_frequency_by_user_10m', 'medium', $log, [
                    'threshold' => 20,
                    'window_seconds' => 600,
                    'request_count' => $subscribeByUserIn10m,
                ]);
            }

            $subscribeSuccessIn24h = SubscribeLog::query()
                ->where('user_id', $log->user_id)
                ->where('status', 'success')
                ->where('created_at', '>=', $now - 86400);

            $subscribeCountIn24h = (clone $subscribeSuccessIn24h)->count();
            $trafficUsageMaxIn24h = (clone $subscribeSuccessIn24h)->selectRaw('MAX(COALESCE(traffic_u, 0) + COALESCE(traffic_d, 0)) as usage')->value('usage');
            $trafficUsageMinIn24h = (clone $subscribeSuccessIn24h)->selectRaw('MIN(COALESCE(traffic_u, 0) + COALESCE(traffic_d, 0)) as usage')->value('usage');
            $trafficGrowthIn24h = max((int) $trafficUsageMaxIn24h - (int) $trafficUsageMinIn24h, 0);

            if ($subscribeCountIn24h >= 20 && $trafficGrowthIn24h <= 50 * 1024 * 1024) {
                $this->recordRuleHit('subscribe', 'subscribe_high_pull_low_traffic_24h', 'high', $log, [
                    'subscribe_threshold' => 20,
                    'traffic_growth_threshold_bytes' => 50 * 1024 * 1024,
                    'window_seconds' => 86400,
                    'subscribe_count' => $subscribeCountIn24h,
                    'traffic_growth_bytes' => $trafficGrowthIn24h,
                ]);
            }

            $distinctClientTypeIn24h = SubscribeLog::query()
                ->where('user_id', $log->user_id)
                ->where('created_at', '>=', $now - 86400)
                ->whereNotNull('client_type')
                ->distinct('client_type')
                ->count('client_type');

            if ($distinctClientTypeIn24h >= 5) {
                $this->recordRuleHit('subscribe', 'subscribe_client_type_spread_24h', 'low', $log, [
                    'threshold' => 5,
                    'window_seconds' => 86400,
                    'distinct_client_type_count' => $distinctClientTypeIn24h,
                ]);
            }
        }

        if (!empty($log->ip)) {
            $failedByIpIn10m = SubscribeLog::query()
                ->where('ip', $log->ip)
                ->where('status', 'failed')
                ->where('created_at', '>=', $now - 600)
                ->count();

            if ($failedByIpIn10m >= 10) {
                $this->recordRuleHit('subscribe', 'subscribe_failed_burst_by_ip_10m', 'high', $log, [
                    'threshold' => 10,
                    'window_seconds' => 600,
                    'failed_count' => $failedByIpIn10m,
                ]);
            }
        }
    }

    private function recordRuleHit(string $scene, string $ruleKey, string $riskLevel, $log, array $payload): void
    {
        $hitAt = (int) ($log->created_at ?? time());

        $exists = RiskRuleHit::query()
            ->where('scene', $scene)
            ->where('rule_key', $ruleKey)
            ->where('user_id', $log->user_id)
            ->where('email', $log->email)
            ->where('ip', $log->ip)
            ->where('hit_at', '>=', $hitAt - 60)
            ->exists();

        if ($exists) {
            return;
        }

        RiskRuleHit::create([
            'scene' => $scene,
            'rule_key' => $ruleKey,
            'risk_level' => $riskLevel,
            'user_id' => $log->user_id,
            'email' => $log->email,
            'ip' => $log->ip,
            'client_type' => $log->client_type ?? null,
            'status' => $log->status ?? null,
            'reason' => $log->reason ?? null,
            'payload' => $payload,
            'hit_at' => $hitAt,
        ]);
    }
}
