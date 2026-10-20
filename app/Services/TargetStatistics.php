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
    private const LOCK = 'target-statistics:policy';

    public function policy(): array
    {
        $saved = json_decode(RiskSetting::where('key', self::SETTING)->value('value') ?? '{}', true);
        return [
            'enabled' => ($saved['enabled'] ?? false) === true,
            'version' => $saved['version'] ?? '00000000-0000-0000-0000-000000000000',
            'leaseSeconds' => 120,
        ];
    }

    public function configure(bool $enabled): array
    {
        return Cache::lock(self::LOCK, 15)->block(5, function () use ($enabled) {
            $policy = $this->policy();
            if ($policy['enabled'] === $enabled) return $policy;
            RiskSetting::updateOrCreate(['key'=>self::SETTING], ['value'=>json_encode([
                'enabled'=>$enabled, 'version'=>(string)Str::uuid(),
            ])]);
            return $this->policy();
        });
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

    private function key(int $nodeId, string $version): string
    {
        return 'target-statistics:v1:'.$version.':'.$nodeId;
    }

    private function prune(array $state): array
    {
        $cutoff = intdiv(time(), 300) * 300 - 3300;
        $state['buckets'] = array_filter($state['buckets'] ?? [], fn($at)=>$at >= $cutoff, ARRAY_FILTER_USE_KEY);
        $state['batches'] = array_filter($state['batches'] ?? [], fn($batch)=>$batch['at'] >= time()-3600);
        return $state;
    }

    public function receive(ServerV2box $node, array $input): array
    {
        // Shares the settings lock: after disable returns, no in-flight batch can write.
        return Cache::lock(self::LOCK, 15)->block(5, function () use ($node, $input) {
            $policy = $this->policy();
            if (!$policy['enabled'] || $input['version'] !== $policy['version'])
                return ['accepted'=>false];
            $key = $this->key((int)$node->id, $policy['version']);
            $state = $this->prune(Cache::get($key, []));
            $hash=hash('sha256',json_encode($input));
            if (isset($state['batches'][$input['batchId']])) {
                abort_unless(hash_equals($state['batches'][$input['batchId']]['hash'],$hash),409,'Batch content changed');
                return ['accepted'=>true];
            }
            // Refuse overload instead of evicting deduplication keys and double-counting retries.
            abort_if(count($state['batches']) >= 1000, 429, 'Statistics capacity reached');
            $allowed = TrafficCreditService::constrainGroups(
                User::whereIn('id', array_column($input['records'], 'userId')),
                $node->group_id ?? []
            )->pluck('id')->flip();
            $bucket = intdiv(time(), 300)*300;
            $rows = $state['buckets'][$bucket]['rows'] ?? [];
            $dropped = (int)($state['buckets'][$bucket]['dropped'] ?? 0) + $input['dropped'];
            foreach ($input['records'] as $record) {
                if (!isset($allowed[$record['userId']])) continue;
                $record['userId'] = (int)$record['userId'];
                foreach (['connections','uploadBytes','downloadBytes'] as $field) $record[$field]=(int)$record[$field];
                $record['target'] = self::target($record['target'], $record['type']);
                $identity = hash('sha256', $record['userId'].'|'.$record['type'].'|'.$record['target']);
                if (!isset($rows[$identity]) && count($rows) >= 500) { $dropped++; continue; }
                $row = $rows[$identity] ?? array_merge($record, [
                    'connections'=>0, 'uploadBytes'=>0, 'downloadBytes'=>0,
                ]);
                foreach (['connections','uploadBytes','downloadBytes'] as $field) $row[$field] += $record[$field];
                $rows[$identity] = $row;
            }
            $state['buckets'][$bucket] = ['rows'=>$rows, 'dropped'=>$dropped];
            $state['batches'][$input['batchId']] = ['at'=>time(),'hash'=>$hash];
            abort_unless(Cache::put($key, $state, 3600), 503, 'Statistics unavailable');
            return ['accepted'=>true];
        });
    }

    public function report(int $nodeId, int $userId, int $page): array
    {
        $policy = $this->policy();
        $nodes = ServerV2box::orderBy('id')->get(['id','name'])->map(function ($node) {
            $features = Cache::get('V2BOX_CAPABILITIES:'.$node->id, [])['features'] ?? [];
            return ['id'=>(int)$node->id, 'name'=>$node->name,
                'supported'=>in_array('target-statistics-v1', $features, true)];
        })->all();
        $rows = []; $dropped = 0;
        if ($policy['enabled'] && in_array($nodeId, array_column($nodes,'id'), true)) {
            $state = $this->prune(Cache::get($this->key($nodeId,$policy['version']), []));
            foreach ($state['buckets'] as $bucket) {
                $dropped += $bucket['dropped'];
                foreach ($bucket['rows'] as $key=>$row) {
                    if ($userId && $row['userId'] !== $userId) continue;
                    if (!isset($rows[$key])) $rows[$key]=$row;
                    else foreach (['connections','uploadBytes','downloadBytes'] as $field) $rows[$key][$field]+=$row[$field];
                }
            }
        }
        usort($rows, fn($a,$b)=>($b['uploadBytes']+$b['downloadBytes']) <=> ($a['uploadBytes']+$a['downloadBytes']));
        return ['settings'=>$policy, 'nodes'=>$nodes, 'rows'=>array_slice($rows,($page-1)*25,25),
            'total'=>count($rows), 'page'=>$page, 'pageSize'=>25, 'dropped'=>$dropped];
    }
}
