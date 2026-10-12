<?php

namespace App\Services;

use App\Models\LoginLog;
use App\Models\RiskRuleConfig;
use App\Models\RiskRuleHit;
use App\Models\SubscribeLog;
use App\Services\RiskBlacklistService;

class RiskLogService
{
    private static $ruleConfigMap = null;
    private const MAX_REASON_LENGTH = 190;

    public static function clearRuleCache(): void
    {
        self::$ruleConfigMap = null;
    }

    public function createLoginLog(array $payload): void
    {
        $payload = $this->sanitizePayload($payload);
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

        // Login events remain available for auditing without risk evaluation.
    }

    public function createSubscribeLog(array $payload): void
    {
        $payload = $this->sanitizePayload($payload);
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

    public function getRuleDefinitions(): array
    {
        $map = $this->getRuleConfigMap();
        $rules = [];
        foreach ($map as $ruleKey => $rule) {
            $rules[] = [
                'scene' => $rule['scene'],
                'rule_key' => $ruleKey,
                'name' => $rule['name'] ?? $ruleKey,
                'risk_level' => $rule['risk_level'],
                'description' => $rule['description'],
                'thresholds' => $rule['thresholds'],
                'default_thresholds' => self::defaultRuleDefinitions()[$ruleKey]['thresholds'],
                'enabled' => (int) $rule['enabled'],
                'sort' => (int) ($rule['sort'] ?? 0),
            ];
        }

        usort($rules, function ($a, $b) {
            return [$a['scene'], $a['sort'], $a['rule_key']] <=> [$b['scene'], $b['sort'], $b['rule_key']];
        });

        return $rules;
    }

    private function evaluateSubscribeRules(SubscribeLog $log): void
    {
        $now = time();

        $rule = $this->getRule('subscribe_ua_hash_blacklist_hit');
        if ($rule['enabled']) {
            if ($this->isBlacklisted('ua_hash', $log->ua_hash)) {
                $this->recordRuleHit('subscribe', $rule['rule_key'], $rule['risk_level'], $log, [
                    'ua_hash' => $log->ua_hash,
                ]);
            }
        }

        if (!empty($log->user_id)) {
            $rule = $this->getRule('subscribe_high_frequency_by_user_10m');
            if ($rule['enabled']) {
                $windowSeconds = $this->thresholdInt($rule, 'window_seconds', 600);
                $threshold = $this->thresholdInt($rule, 'threshold', 20);
                $subscribeCount = SubscribeLog::query()
                    ->where('user_id', $log->user_id)
                    ->where('created_at', '>=', $now - $windowSeconds)
                    ->count();

                if ($subscribeCount >= $threshold) {
                    $this->recordRuleHit('subscribe', $rule['rule_key'], $rule['risk_level'], $log, [
                        'threshold' => $threshold,
                        'window_seconds' => $windowSeconds,
                        'request_count' => $subscribeCount,
                    ]);
                }
            }

            $rule = $this->getRule('subscribe_high_pull_low_traffic_24h');
            if ($rule['enabled']) {
                $windowSeconds = $this->thresholdInt($rule, 'window_seconds', 86400);
                $subscribeThreshold = $this->thresholdInt($rule, 'subscribe_threshold', 20);
                $trafficThresholdBytes = $this->thresholdInt($rule, 'traffic_growth_threshold_bytes', 50 * 1024 * 1024);

                $subscribeSuccess = SubscribeLog::query()
                    ->where('user_id', $log->user_id)
                    ->where('status', 'success')
                    ->whereNotNull('traffic_u')
                    ->whereNotNull('traffic_d')
                    ->where('created_at', '>=', $now - $windowSeconds);

                $subscribeCount = (clone $subscribeSuccess)->count();
                $trafficUsageMax = (clone $subscribeSuccess)
                    ->selectRaw('MAX(COALESCE(traffic_u, 0) + COALESCE(traffic_d, 0)) as traffic_usage')
                    ->value('traffic_usage');
                $trafficUsageMin = (clone $subscribeSuccess)
                    ->selectRaw('MIN(COALESCE(traffic_u, 0) + COALESCE(traffic_d, 0)) as traffic_usage')
                    ->value('traffic_usage');
                $trafficGrowth = max((int) $trafficUsageMax - (int) $trafficUsageMin, 0);

                if ($log->status === 'success' && $subscribeCount >= max(2, $subscribeThreshold) && $trafficGrowth <= $trafficThresholdBytes) {
                    $this->recordRuleHit('subscribe', $rule['rule_key'], $rule['risk_level'], $log, [
                        'subscribe_threshold' => $subscribeThreshold,
                        'traffic_growth_threshold_bytes' => $trafficThresholdBytes,
                        'window_seconds' => $windowSeconds,
                        'subscribe_count' => $subscribeCount,
                        'traffic_growth_bytes' => $trafficGrowth,
                    ]);
                }
            }

            $rule = $this->getRule('subscribe_client_type_spread_24h');
            if ($rule['enabled']) {
                $windowSeconds = $this->thresholdInt($rule, 'window_seconds', 86400);
                $threshold = $this->thresholdInt($rule, 'threshold', 5);
                $distinctClientType = SubscribeLog::query()
                    ->where('user_id', $log->user_id)
                    ->where('created_at', '>=', $now - $windowSeconds)
                    ->whereNotNull('client_type')
                    ->distinct('client_type')
                    ->count('client_type');

                if ($distinctClientType >= $threshold) {
                    $this->recordRuleHit('subscribe', $rule['rule_key'], $rule['risk_level'], $log, [
                        'threshold' => $threshold,
                        'window_seconds' => $windowSeconds,
                        'distinct_client_type_count' => $distinctClientType,
                    ]);
                }
            }
        }

    }

    private function getRule(string $ruleKey): array
    {
        $map = $this->getRuleConfigMap();
        return $map[$ruleKey] ?? self::defaultRuleDefinitions()[$ruleKey];
    }

    private function thresholdInt(array $rule, string $key, int $default): int
    {
        return (int) ($rule['thresholds'][$key] ?? $default);
    }

    private function getRuleConfigMap(): array
    {
        if (!is_null(self::$ruleConfigMap)) {
            return self::$ruleConfigMap;
        }

        $defaults = self::defaultRuleDefinitions();

        try {
            $rows = RiskRuleConfig::query()->orderBy('id')->get()->toArray();
            foreach ($rows as $row) {
                $ruleKey = $row['rule_key'];
                if (!isset($defaults[$ruleKey])) {
                    continue;
                }

                $defaults[$ruleKey] = array_merge($defaults[$ruleKey], [
                    'name' => $row['name'] ?: $defaults[$ruleKey]['name'],
                    'description' => $row['description'] ?: $defaults[$ruleKey]['description'],
                    'risk_level' => $row['risk_level'] ?: $defaults[$ruleKey]['risk_level'],
                    'thresholds' => array_merge($defaults[$ruleKey]['thresholds'], $row['thresholds'] ?? []),
                    'enabled' => (int) $row['enabled'],
                    'sort' => (int) ($row['sort'] ?? $defaults[$ruleKey]['sort']),
                ]);
            }
        } catch (\Throwable $e) {
        }

        self::$ruleConfigMap = $defaults;
        return self::$ruleConfigMap;
    }

    public static function defaultRuleDefinitions(): array
    {
        return [
            'subscribe_high_frequency_by_user_10m' => [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_high_frequency_by_user_10m',
                'name' => '订阅高频拉取',
                'risk_level' => 'medium',
                'description' => '同一用户 10 分钟内订阅拉取次数 >= 20',
                'thresholds' => [
                    'threshold' => 20,
                    'window_seconds' => 600,
                ],
                'enabled' => 1,
                'sort' => 30,
            ],
            'subscribe_high_pull_low_traffic_24h' => [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_high_pull_low_traffic_24h',
                'name' => '高拉取低流量',
                'risk_level' => 'high',
                'description' => '同一用户 24 小时内订阅成功次数 >= 20 且上下行总流量增长 <= 50MB',
                'thresholds' => [
                    'subscribe_threshold' => 20,
                    'traffic_growth_threshold_bytes' => 50 * 1024 * 1024,
                    'window_seconds' => 86400,
                ],
                'enabled' => 1,
                'sort' => 40,
            ],
            'subscribe_client_type_spread_24h' => [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_client_type_spread_24h',
                'name' => '客户端类型扩散',
                'risk_level' => 'low',
                'description' => '同一用户 24 小时内订阅客户端类型数量 >= 5',
                'thresholds' => [
                    'threshold' => 5,
                    'window_seconds' => 86400,
                ],
                'enabled' => 1,
                'sort' => 50,
            ],
            'subscribe_ua_hash_blacklist_hit' => [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_ua_hash_blacklist_hit',
                'name' => '订阅UA哈希黑名单命中',
                'risk_level' => 'high',
                'description' => '订阅请求命中UA哈希黑名单',
                'thresholds' => [],
                'enabled' => 1,
                'sort' => 66,
            ],
        ];
    }

    public static function ruleName(string $key): string
    {
        $historical = [
            'login_failed_burst_by_ip_10m' => '登录失败频繁（已停用）',
            'login_account_multi_ip_1h' => '账号多IP登录（已停用）',
            'login_ip_blacklist_hit' => '登录IP黑名单命中（已停用）',
            'login_ua_hash_blacklist_hit' => '登录UA哈希黑名单命中（已停用）',
            'subscribe_failed_burst_by_ip_10m' => '订阅失败IP爆发（已停用）',
            'subscribe_ip_blacklist_hit' => '订阅IP黑名单命中（已停用）',
        ];
        return self::defaultRuleDefinitions()[$key]['name'] ?? $historical[$key] ?? '历史规则（已停用）';
    }

    private function isBlacklisted(string $type, ?string $value): bool
    {
        return (new RiskBlacklistService())->exists($type, $value);
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
            'reason' => $this->normalizeReason($log->reason ?? null),
            'payload' => $payload,
            'hit_at' => $hitAt,
        ]);
    }

    private function sanitizePayload(array $payload): array
    {
        if (array_key_exists('reason', $payload)) {
            $payload['reason'] = $this->normalizeReason($payload['reason']);
        }

        return $payload;
    }

    private function normalizeReason(?string $reason): ?string
    {
        if (is_null($reason) || $reason === '') {
            return null;
        }

        if (function_exists('mb_substr')) {
            return mb_substr($reason, 0, self::MAX_REASON_LENGTH);
        }

        return substr($reason, 0, self::MAX_REASON_LENGTH);
    }
}
