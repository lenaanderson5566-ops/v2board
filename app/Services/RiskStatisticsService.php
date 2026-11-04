<?php

namespace App\Services;

use App\Models\RiskRuleHit;
use App\Models\SubscribeLog;
use App\Models\StatServer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/** Read-only reporting for the existing operations risk endpoints. */
final class RiskStatisticsService
{
    private const REVIEW_RULES = [
        'subscribe_high_frequency_by_user_10m',
        'subscribe_high_pull_low_traffic_24h',
        'subscribe_client_type_spread_24h',
    ];
    private const REVIEW_STATE = 'payload->review->state';

    public function pendingReview(Builder $query, int $now): Builder
    {
        return $query->where('scene', 'subscribe')->where('risk_level', 'high')
            ->whereIn('rule_key', self::REVIEW_RULES)->whereBetween('hit_at', [1, $now])
            ->whereExists(function ($users) {
                $users->selectRaw('1')->from('v2_user')->whereColumn('v2_user.id', 'v2_risk_rule_hit.user_id')
                    ->whereNull('v2_user.account_deleted_at');
            })->where(fn ($review) => $review->whereNull(self::REVIEW_STATE)
                ->orWhereNotIn(self::REVIEW_STATE, ['confirmed', 'false_positive', 'ignored']));
    }

    public function dashboard(string $window): array
    {
        $days = ['today' => 1, '7d' => 7, '30d' => 30][$window];
        $now = time();
        $since = $now - $days * 86400;
        $pending = $this->pendingReview(RiskRuleHit::query(), $now)->toBase()
            ->selectRaw('COUNT(*) AS total, COUNT(DISTINCT user_id) AS accounts, MIN(hit_at) AS oldest_at')->first();

        $reviewState = "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.review.state'))";
        $rules = RiskRuleHit::query()->whereBetween('hit_at', [$since, $now])->where('scene', 'subscribe')
            ->whereIn('rule_key', self::REVIEW_RULES)->toBase()->select('rule_key')
            ->selectRaw("COUNT(*) AS hits, COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id END) AS accounts,
                SUM(CASE WHEN $reviewState = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN $reviewState = 'false_positive' THEN 1 ELSE 0 END) AS false_positives")
            ->groupBy('rule_key')->orderByDesc('false_positives')->orderByDesc('hits')->orderBy('rule_key')->get()
            ->map(fn ($rule) => ['name' => RiskLogService::ruleName($rule->rule_key), 'hits' => (int)$rule->hits,
                'accounts' => (int)$rule->accounts, 'confirmed' => (int)$rule->confirmed, 'false_positives' => (int)$rule->false_positives]);

        return [
            'review_queue' => ['total' => (int)$pending->total, 'accounts' => (int)$pending->accounts,
                'oldest_at' => $pending->oldest_at === null ? null : (int)$pending->oldest_at],
            'blacklist' => $this->blacklistDenials($since, $now, $days === 1),
            'rules' => $rules->all(),
        ];
    }

    private function blacklistDenials(int $since, int $now, bool $hourly): array
    {
        if ($hourly) {
            $buckets = range(intdiv($since, 3600) * 3600, $now, 3600);
        } else {
            $zone = new \DateTimeZone(TimeZones::system());
            $day = (new \DateTimeImmutable('@'.$since))->setTimezone($zone)->setTime(0, 0);
            $buckets = [];
            for (; $day->getTimestamp() <= $now; $day = $day->modify('+1 day')->setTime(0, 0)) {
                $buckets[] = $day->getTimestamp();
            }
        }
        $case = [];
        $bindings = [];
        foreach (array_slice($buckets, 1) as $index => $end) {
            $case[] = 'WHEN created_at < ? THEN ?';
            array_push($bindings, $end, $buckets[$index]);
        }
        $bindings[] = $buckets[array_key_last($buckets)];
        $expression = $case ? 'CASE '.implode(' ', $case).' ELSE ? END' : '?';

        // Blacklist denials are recorded before authentication. Rule hits can be sampled or disabled.
        $ipReason = RiskLogService::IP_BLACKLIST_REASON;
        $uaReason = RiskLogService::UA_BLACKLIST_REASON;
        $denials = SubscribeLog::query()->whereBetween('created_at', [$since, $now])
            ->where('status', 'failed')->whereIn('reason', [$ipReason, $uaReason])->toBase()
            ->select('reason')->selectRaw("{$expression} AS bucket, COUNT(*) AS total", $bindings)
            ->groupBy('reason', 'bucket')->get()->groupBy('reason');
        $ip = $denials->get($ipReason, collect())->pluck('total', 'bucket');
        $ua = $denials->get($uaReason, collect())->pluck('total', 'bucket');
        return ['ip' => (int)$ip->sum(), 'ua' => (int)$ua->sum(), 'trend' => array_map(
            fn ($at) => ['at' => $at, 'ip' => (int)$ip->get($at, 0), 'ua' => (int)$ua->get($at, 0)], $buckets
        )];
    }

    public function summary(string $window = 'today'): array
    {
        $days = ['today' => 1, '7d' => 7, '30d' => 30][$window];
        $since = time() - $days * 86400;
        $query = RiskRuleHit::query()->where('hit_at', '>=', $since);
        $total = (clone $query)->count();
        $blocked = (clone $query)->whereIn('status', ['blocked', 'block', 'deny', 'rejected'])->count();
        $definitions = collect((new RiskLogService())->getRuleDefinitions())->keyBy('rule_key');
        $ranking = (clone $query)->select('rule_key')->selectRaw('COUNT(*) as hits')
            ->groupBy('rule_key')->orderByDesc('hits')->limit(10)->get()->map(function ($row) use ($definitions) {
                return ['rule_key' => $row->rule_key, 'name' => RiskLogService::ruleName($row->rule_key), 'hits' => (int) $row->hits];
            });
        $recent = (clone $query)->orderByDesc('hit_at')->limit(20)
            ->get(['id', 'rule_key', 'risk_level', 'scene', 'user_id', 'email', 'ip', 'status', 'hit_at'])->map(function ($row) use ($definitions) {
                $row->name = RiskLogService::ruleName($row->rule_key);
                return $row;
            });
        // Fixed epoch buckets avoid loading all hit records into PHP memory.
        $bucket = $days === 1 ? 3600 : 86400;
        $counts = (clone $query)->selectRaw('FLOOR(hit_at / ' . $bucket . ') as bucket, COUNT(*) as hits')
            ->groupBy('bucket')->pluck('hits', 'bucket');
        $trend = [];
        for ($i = (int) floor($since / $bucket); $i <= (int) floor(time() / $bucket); $i++) {
            $trend[] = ['at' => $i * $bucket, 'hits' => (int) ($counts[$i] ?? 0)];
        }
        return [
            'total' => $total, 'blocked' => $blocked,
            'users' => (clone $query)->whereNotNull('user_id')->distinct()->count('user_id'),
            'high' => (clone $query)->where('risk_level', 'high')->count(),
            'enabled_rules' => $definitions->where('enabled', 1)->count(),
            'total_rules' => $definitions->count(),
            'ranking' => $ranking, 'recent' => $recent, 'trend' => $trend,
        ];
    }

    public function overview(): array
    {
        $now = time();
        $windows = [
            'today' => ['label' => '当日', 'seconds' => 86400],
            '7d' => ['label' => '近7天', 'seconds' => 7 * 86400],
            '30d' => ['label' => '近30天', 'seconds' => 30 * 86400],
        ];

        $overview = [];
        foreach ($windows as $key => $item) {
            $overview[$key] = $this->windowMetrics($now - $item['seconds'], $item['label']);
        }

        $cutoff24h = $now - 86400;
        $cutoff30d = $now - (30 * 86400);

        [$flagClientRanking, $uaRawDetails30d] = $this->clientRankings($cutoff24h, $cutoff30d);

        return [
            'windows' => $overview,
            'metrics' => [
                'active_users' => [
                    'today' => $overview['today']['active_users'] ?? ['users' => 0, 'hits' => 0],
                    '7d' => $overview['7d']['active_users'] ?? ['users' => 0, 'hits' => 0],
                    '30d' => $overview['30d']['active_users'] ?? ['users' => 0, 'hits' => 0],
                ],
                'traffic' => [
                    'today' => $overview['today']['traffic'] ?? ['up_bytes' => 0, 'down_bytes' => 0, 'total_bytes' => 0],
                    '7d' => $overview['7d']['traffic'] ?? ['up_bytes' => 0, 'down_bytes' => 0, 'total_bytes' => 0],
                    '30d' => $overview['30d']['traffic'] ?? ['up_bytes' => 0, 'down_bytes' => 0, 'total_bytes' => 0],
                ],
                'risk_result' => [
                    'today' => $overview['today']['risk_result'] ?? [],
                    '7d' => $overview['7d']['risk_result'] ?? [],
                    '30d' => $overview['30d']['risk_result'] ?? [],
                ],
            ],
            'flag_client_ranking' => $flagClientRanking,
            'ua_raw_details_30d' => $uaRawDetails30d,
        ];
    }

    private function windowMetrics(int $cutoff, string $label): array
    {
        $activeBuilder = SubscribeLog::query()->whereNotNull('user_id')->where('created_at', '>=', $cutoff);
        $activeUsers = (clone $activeBuilder)->distinct('user_id')->count('user_id');
        $activeHits = (clone $activeBuilder)->count();

        $trafficRecordAtStart = strtotime(date('Y-m-d', $cutoff));
        $trafficBuilder = StatServer::query()
            ->where('record_type', 'd')
            ->where('record_at', '>=', $trafficRecordAtStart);
        $trafficUp = (int) (clone $trafficBuilder)->sum('u');
        $trafficDown = (int) (clone $trafficBuilder)->sum('d');

        $topUa = SubscribeLog::query()
            ->selectRaw('user_agent, COUNT(*) as hits')
            ->where('created_at', '>=', $cutoff)
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->groupBy('user_agent')
            ->orderByDesc('hits')
            ->get();

        $topFlags = SubscribeLog::query()
            ->selectRaw('client_type as flag, COUNT(*) as hits')
            ->where('created_at', '>=', $cutoff)
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->groupBy('client_type')
            ->orderByDesc('hits')
            ->get();

        $ruleHitBuilder = RiskRuleHit::query()->where('hit_at', '>=', $cutoff);
        $blockedBuilder = (clone $ruleHitBuilder)->whereIn('status', ['blocked', 'block', 'deny', 'rejected']);
        $blockedHits = (clone $blockedBuilder)->count();
        $totalRuleHits = (clone $ruleHitBuilder)->count();
        $totalRuleUsers = (clone $ruleHitBuilder)->distinct('user_id')->count('user_id');
        $blockedUsers = (clone $blockedBuilder)->distinct('user_id')->count('user_id');

        return [
            'label' => $label,
            'active_users' => [
                'users' => $activeUsers,
                'hits' => $activeHits,
            ],
            'traffic' => [
                'up_bytes' => $trafficUp,
                'down_bytes' => $trafficDown,
                'total_bytes' => $trafficUp + $trafficDown,
            ],
            'ua_top' => $topUa,
            'flag_top' => $topFlags,
            'risk_result' => [
                'blocked_hits' => $blockedHits,
                'blocked_users' => $blockedUsers,
                'pass_hits' => max($totalRuleHits - $blockedHits, 0),
                'pass_users' => max($totalRuleUsers - $blockedUsers, 0),
                'blocked_rate' => $this->percent($totalRuleHits, $blockedHits),
            ],
        ];
    }

    private function clientRankings(int $cutoff24h, int $cutoff30d): array
    {
        $strategyMap = collect((new ClientStrategyService())->getStrategies())
            ->mapWithKeys(function ($item) {
                $row = is_array($item) ? $item : $item->toArray();
                $type = strtolower(trim((string) ($row['client_type'] ?? '')));
                if (!$type) {
                    return [];
                }
                $name = trim((string) ($row['client_name'] ?? ''));
                return [$type => ($name ?: $type)];
            })->toArray();

        $flag24hMap = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as client_type, COUNT(*) as hits_24h')
            ->where('created_at', '>=', $cutoff24h)
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->pluck('hits_24h', 'client_type')
            ->toArray();

        $flag30dRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as client_type, COUNT(*) as hits_30d')
            ->where('created_at', '>=', $cutoff30d)
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'))
            ->orderByDesc('hits_30d')
            ->get();

        $flagClientRanking = $flag30dRows->map(function ($row) use ($flag24hMap, $strategyMap) {
            $type = strtolower(trim((string) $row->client_type));
            $displayType = urldecode($type);
            $displayName = $strategyMap[$type] ?? ucfirst($displayType);
            return [
                'client_type' => $displayType,
                'client_name' => $displayName,
                'hits_24h' => (int) ($flag24hMap[$type] ?? 0),
                'hits_30d' => (int) ($row->hits_30d ?? 0),
            ];
        })->values();

        $ua24hMap = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as client_type, user_agent, COUNT(*) as hits_24h')
            ->where('created_at', '>=', $cutoff24h)
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'), 'user_agent')
            ->get()
            ->mapWithKeys(function ($row) {
                $key = strtolower(trim((string) $row->client_type)) . '||' . trim((string) $row->user_agent);
                return [$key => (int) ($row->hits_24h ?? 0)];
            })
            ->toArray();

        $ua30dRows = SubscribeLog::query()
            ->selectRaw('LOWER(TRIM(client_type)) as client_type, user_agent, COUNT(*) as hits_30d')
            ->where('created_at', '>=', $cutoff30d)
            ->whereNotNull('client_type')
            ->where('client_type', '<>', '')
            ->whereNotNull('user_agent')
            ->where('user_agent', '<>', '')
            ->groupBy(DB::raw('LOWER(TRIM(client_type))'), 'user_agent')
            ->orderBy(DB::raw('LOWER(TRIM(client_type))'))
            ->orderByDesc('hits_30d')
            ->get();

        $uaRawDetails30d = [];
        foreach ($ua30dRows as $row) {
            $type = strtolower(trim((string) $row->client_type));
            if (!isset($uaRawDetails30d[$type])) {
                $uaRawDetails30d[$type] = [
                    'client_type' => urldecode($type),
                    'client_name' => $strategyMap[$type] ?? ucfirst(urldecode($type)),
                    'ua_rows' => [],
                ];
            }
            $ua = trim((string) $row->user_agent);
            $k = $type . '||' . $ua;
            $uaRawDetails30d[$type]['ua_rows'][] = [
                'user_agent' => $ua,
                'hits_24h' => (int) ($ua24hMap[$k] ?? 0),
                'hits_30d' => (int) ($row->hits_30d ?? 0),
            ];
        }
        $uaRawDetails30d = array_values($uaRawDetails30d);
        return [$flagClientRanking, $uaRawDetails30d];
    }

    // Strategy observations retain the legacy FastAI-UA override; overview rankings
    // intentionally continue to report the stored client labels.
    private const OBSERVED_CLIENT_TYPE = "CASE WHEN LOWER(TRIM(user_agent)) REGEXP '^fastai([/ _-]|$)' THEN 'fastai' ELSE LOWER(TRIM(client_type)) END";

    public function clientSubscriptionStats($strategies): Collection
    {
        $items = collect($strategies)->map(function ($item) {
            return is_array($item) ? $item : $item->toArray();
        });
        if ($items->isEmpty()) {
            return $items;
        }

        $now = time();
        $cutoff24h = $now - 86400;
        $cutoff30d = $now - 30 * 86400;
        $clientTypes = $items->pluck('client_type')
            ->map(fn ($type) => strtolower(trim((string) $type)))
            ->filter()->unique()->values()->toArray();

        $totals = $this->subscriptionQuery($cutoff30d, $clientTypes)
            ->selectRaw(self::OBSERVED_CLIENT_TYPE . ' as normalized_client_type, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as count_24h, COUNT(*) as count_30d', [$cutoff24h])
            ->groupBy(DB::raw(self::OBSERVED_CLIENT_TYPE))
            ->get()->keyBy('normalized_client_type');

        $observations = $this->subscriptionQuery($cutoff30d, $clientTypes)
            ->selectRaw(self::OBSERVED_CLIENT_TYPE . ' as normalized_client_type, user_agent, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as count_24h, COUNT(*) as count_30d, MAX(created_at) as last_seen', [$cutoff24h])
            ->whereNotNull('user_agent')->where('user_agent', '<>', '')
            ->groupBy(DB::raw(self::OBSERVED_CLIENT_TYPE), 'user_agent')
            ->orderBy('count_30d', 'desc')->orderBy('count_24h', 'desc')->get();

        $unique24h = [];
        $unique30d = [];
        $top = [];
        $details = [];
        foreach ($observations as $row) {
            $type = (string) $row->normalized_client_type;
            // One row per SQL-distinct UA. Count before trimming display values,
            // preserving the original COUNT(DISTINCT user_agent) semantics.
            $unique30d[$type] = ($unique30d[$type] ?? 0) + 1;
            $unique24h[$type] = ($unique24h[$type] ?? 0) + ((int) $row->count_24h > 0 ? 1 : 0);
            if (!isset($top[$type]) || (int) $row->count_30d > $top[$type]['count']) {
                $top[$type] = ['ua' => (string) $row->user_agent, 'count' => (int) $row->count_30d];
            }
            $ua = trim((string) $row->user_agent);
            if (!$ua) {
                continue;
            }
            $details[$type][] = [
                'ua' => $ua,
                'count_24h' => (int) $row->count_24h,
                'count_30d' => (int) $row->count_30d,
                'last_seen' => (int) $row->last_seen,
                'version' => ClientIdentity::identify($ua) === $type ? ClientIdentity::version($type, $ua) : null,
            ];
        }

        return $items->map(function ($item) use ($totals, $unique24h, $unique30d, $top, $details) {
            $type = strtolower(trim((string) ($item['client_type'] ?? '')));
            $item['subscribe_flag_count_24h'] = (int) ($totals[$type]->count_24h ?? 0);
            $item['subscribe_flag_count_30d'] = (int) ($totals[$type]->count_30d ?? 0);
            $item['subscribe_ua_unique_count_24h'] = $unique24h[$type] ?? 0;
            $item['subscribe_ua_unique_count_30d'] = $unique30d[$type] ?? 0;
            $item['top_raw_ua'] = $top[$type]['ua'] ?? '';
            $item['top_raw_ua_count'] = $top[$type]['count'] ?? 0;
            $item['raw_ua_stats'] = $details[$type] ?? [];
            $item['raw_ua_list'] = array_column($item['raw_ua_stats'], 'ua');
            $observations = $item['raw_ua_stats'];
            $lastSeen = $observations ? max(array_column($observations, 'last_seen')) : null;
            $recognized = array_sum(array_map(fn ($row) => $row['version'] !== null ? $row['count_24h'] : 0, $observations));
            $total = $item['subscribe_flag_count_24h'];
            $item['ua_observation'] = $lastSeen ? '近30天已观测（不证明真实性）' : '近30天未观测';
            $item['ua_last_seen_at'] = $lastSeen;
            $item['ua_version_recognized_24h'] = $recognized;
            $item['ua_version_coverage_24h'] = $total ? round($recognized * 100 / $total, 1) . '%（' . $recognized . '/' . $total . '）' : '暂无请求';
            return $item;
        });
    }

    private function subscriptionQuery(int $since, array $clientTypes): Builder
    {
        return SubscribeLog::query()
            ->whereNotNull('client_type')->where('client_type', '<>', '')
            ->where('created_at', '>=', $since)
            ->whereIn(DB::raw(self::OBSERVED_CLIENT_TYPE), $clientTypes);
    }

    private function percent(int $total, int $sub): string
    {
        if ($total <= 0) {
            return '0%';
        }

        return round(($sub / $total) * 100, 2) . '%';
    }
}
