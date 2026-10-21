<?php
namespace App\Services;

use App\Models\RiskSetting;
use App\Models\ServerV2box;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/** Short-lived operational aggregates, independent of billing. Never store URLs or source IPs. */
final class TargetStatistics
{
    private const SETTING = 'target_statistics';
    public function __construct(private TargetStatisticsStore $store) {}

    private function savedPolicy(): array
    {
        $saved = json_decode(RiskSetting::where('key', self::SETTING)->value('value') ?? '{}', true);
        return ['enabled'=>($saved['enabled'] ?? false) === true,
            'dailyRetentionDays'=>in_array($saved['dailyRetentionDays'] ?? null,[0,7,30],true) ? $saved['dailyRetentionDays'] : 7,
            'retentionHours'=>in_array($saved['retentionHours'] ?? null,[1,6,12,24],true) ? $saved['retentionHours'] : 1,
            'version'=>$saved['version'] ?? '00000000-0000-0000-0000-000000000000', 'leaseSeconds'=>120,
            'reportIntervalSeconds'=>in_array($saved['reportIntervalSeconds'] ?? null, [30,60,120,300], true) ? $saved['reportIntervalSeconds'] : 60];
    }

    public function policy(): array
    {
        if ($policy = $this->store->policy()) return $policy + ['reportIntervalSeconds'=>60,'retentionHours'=>1,'dailyRetentionDays'=>7];
        return $this->store->repository()->lock('policy-load', 15)->block(5, function () {
            $policy = $this->store->policy() ?? $this->savedPolicy();
            $this->store->publishPolicy($policy);
            return $policy + ['reportIntervalSeconds'=>60,'retentionHours'=>1,'dailyRetentionDays'=>7];
        });
    }

    public function nodePolicy(): array { return array_intersect_key($this->policy(), array_flip(['enabled','version','leaseSeconds','reportIntervalSeconds'])); }

    public function configure(?bool $enabled = null, ?int $reportIntervalSeconds = null, ?int $retentionHours = null, ?int $dailyRetentionDays = null): array
    {
        return $this->store->repository()->lock('archive-flush', 120)->block(5, fn()=> $this->store->repository()->lock('policy-load', 15)->block(5, function () use ($enabled, $reportIntervalSeconds, $retentionHours, $dailyRetentionDays) {
            $policy = $this->savedPolicy();
            $previousHours=$policy['retentionHours']; $previousDays=$policy['dailyRetentionDays'];
            $dailyRetentionDays ??= $policy['dailyRetentionDays'];
            abort_unless(in_array($dailyRetentionDays,[0,7,30],true),422);
            $retentionHours ??= $policy['retentionHours'];
            abort_unless(in_array($retentionHours,[1,6,12,24],true),422);
            $enabled ??= $policy['enabled'];
            $reportIntervalSeconds ??= $policy['reportIntervalSeconds'];
            abort_unless(in_array($reportIntervalSeconds,[30,60,120,300],true),422);
            if ($policy['dailyRetentionDays'] !== $dailyRetentionDays || $policy['enabled'] !== $enabled || $policy['reportIntervalSeconds'] !== $reportIntervalSeconds || $policy['retentionHours'] !== $retentionHours) {
                if ($policy['enabled'] !== $enabled) $policy['version'] = (string)Str::uuid();
                $policy['retentionHours'] = $retentionHours;
                $policy['dailyRetentionDays'] = $dailyRetentionDays;
                $policy['enabled'] = $enabled;
                $policy['reportIntervalSeconds'] = $reportIntervalSeconds;
                RiskSetting::updateOrCreate(['key'=>self::SETTING], ['value'=>json_encode($policy)]);
            }
            $this->store->publishPolicy($policy);
            if($policy['retentionHours']<$previousHours) app(TargetStatisticsArchive::class)->shorten($policy['retentionHours']);
            if($policy['dailyRetentionDays']<$previousDays) app(TargetStatisticsDaily::class)->shorten($policy['dailyRetentionDays']);
            return $policy;
        }));
    }

    public static function target(string $target, string $type): string
    {
        if ($type === 'ip') {
            abort_unless(filter_var($target, FILTER_VALIDATE_IP), 422, 'Invalid target IP');
            return inet_ntop(inet_pton($target));
        }
        $target = strtolower(rtrim($target, '.'));
        abort_unless(strlen($target) <= 253 && !filter_var($target, FILTER_VALIDATE_IP)
            && preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/D', $target),
            422, 'Invalid target domain');
        return $target;
    }

    public function receive(ServerV2box $node, array $input, int $bytes = 0): array
    {
        $policy = $this->policy();
        if (!$policy['enabled'] || $input['version'] !== $policy['version']) return ['accepted'=>false];
        $allowed = TrafficCreditService::constrainGroups(
            User::whereIn('id', array_column($input['records'], 'userId')), $node->group_id ?? []
        )->pluck('id')->flip();
        $rows = []; $totals = ['connections'=>0, 'uploadBytes'=>0, 'downloadBytes'=>0];
        foreach ($input['records'] as $record) {
            $record['target'] = self::target($record['target'], $record['type']);
            foreach ($totals as $field=>$unused) {
                $record[$field] = (int)$record[$field];
                $totals[$field] += $record[$field];
                // Bound each entire batch, including repeated identities, before any Redis write.
                abort_if($totals[$field] > 1000000000000000, 422, 'Statistics batch counter too large');
            }
            if (!isset($allowed[$record['userId']])) continue;
            $record['userId'] = (int)$record['userId'];
            $rows[] = ['key'=>hash('sha256', $record['userId'].'|'.$record['type'].'|'.$record['target']),
                'meta'=>json_encode(array_intersect_key($record, array_flip(['userId','type','target'])), JSON_THROW_ON_ERROR),
                'connections'=>$record['connections'], 'uploadBytes'=>$record['uploadBytes'], 'downloadBytes'=>$record['downloadBytes']];
        }
        return $this->store->ingest((int)$node->id, $policy['version'], $input['batchId'],
            hash('sha256', json_encode($input)), $rows, (int)$input['dropped'], $bytes);
    }

    public function report(int $nodeId, int $userId, int $page, string $view = 'recent'): array
    {
        $policy = $this->policy();
        $catalog = ServerV2box::orderBy('id')->get(['id','name']);
        $capabilities = Cache::many($catalog->map(fn($node)=>'V2BOX_CAPABILITIES:'.$node->id)->all());
        $nodes = $catalog->map(function ($node) use ($capabilities) {
            $features = $capabilities['V2BOX_CAPABILITIES:'.$node->id]['features'] ?? [];
            return ['id'=>(int)$node->id, 'name'=>$node->name,
                'supported'=>in_array('target-statistics-v1', $features, true),
                'configurableInterval'=>in_array('target-statistics-interval-v1', $features, true)];
        })->all();
        if ($view === 'daily') return array_merge(['settings'=>$policy,'nodes'=>$nodes,'page'=>$page,'pageSize'=>25,'archive'=>app(TargetStatisticsArchive::class)->status()], app(TargetStatisticsDaily::class)->report($nodeId,$policy['dailyRetentionDays'],$page));
        $rows = []; $dropped = 0;
        if ($policy['enabled'] && in_array($nodeId, array_column($nodes,'id'), true)) {
            $state = $this->store->report($nodeId, $policy['version'], $policy['retentionHours'], $userId);
            $rows = array_values(array_filter($state['rows'], fn($row)=>!$userId || $row['userId'] === $userId));
            $dropped = $state['dropped'];
        }
        usort($rows, fn($a,$b)=>($b['uploadBytes']+$b['downloadBytes']) <=> ($a['uploadBytes']+$a['downloadBytes']));
        return ['settings'=>$policy, 'nodes'=>$nodes, 'rows'=>array_slice($rows,($page-1)*25,25),
            'truncated'=>$state['truncated'] ?? false, 'total'=>count($rows), 'page'=>$page, 'pageSize'=>25, 'dropped'=>$dropped, 'usage'=>$this->store->usage(), 'archive'=>app(TargetStatisticsArchive::class)->status()];
    }
}
