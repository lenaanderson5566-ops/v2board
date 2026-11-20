<?php

namespace App\Services;

use App\Models\RiskRuleHit;
use Illuminate\Support\Facades\DB;

final class RiskHitCleanup
{
    private const SAMPLE_LIMIT = 1000;
    private const BATCH_SIZE = 1000;
    private const TTL = 600;
    private const TASKS = 'v2_risk_cleanup_task';
    private const ITEMS = 'v2_risk_cleanup_item';
    private const CONFIRMED = ['queued', 'running', 'completed', 'failed'];

    public function preview(int $adminId, int $before, bool $includePending): array
    {
        return DB::transaction(function () use ($adminId, $before, $includePending) {
            $now = now()->timestamp;
            $token = bin2hex(random_bytes(32));
            $taskId = DB::table(self::TASKS)->insertGetId([
                'admin_id' => $adminId, 'token_hash' => hash('sha256', $token), 'state' => 'preview',
                'expires_at' => $now + self::TTL, 'created_at' => $now, 'updated_at' => $now,
            ]);
            $inRange = RiskRuleHit::query()->where('hit_at', '>', 0)
                ->where('hit_at', '<', min($before, $now + 1));
            $inRange->where('id', '<=', (int) RiskRuleHit::query()->max('id'));
            $query = clone $inRange;
            if (!$includePending) {
                $query->whereIn('payload->review->state', RiskRuleHit::REVIEWED_STATES);
            }

            $matched = 0;
            $reviewed = 0;
            $rows = [];
            // Store every eligible version. Only the sample and one insert batch occupy PHP memory.
            $query->chunkById(500, function ($hits) use ($taskId, &$rows, &$matched, &$reviewed) {
                $items = [];
                foreach ($hits as $hit) {
                    $items[] = ['task_id' => $taskId, 'risk_hit_id' => $hit->id, 'version' => $this->version($hit)];
                    $state = data_get($hit->payload, 'review.state');
                    if (in_array($state, RiskRuleHit::REVIEWED_STATES, true)) {
                        $reviewed++;
                    } else {
                        $state = 'pending';
                    }
                    if (count($rows) < self::SAMPLE_LIMIT) {
                        $rows[] = [
                            'id' => $hit->id, 'hit_at' => (int) $hit->getRawOriginal('hit_at'),
                            'rule_name' => RiskLogService::ruleName((string) $hit->rule_key),
                            'review_state' => $state, 'risk_level' => $hit->risk_level,
                        ];
                    }
                }
                DB::table(self::ITEMS)->insert($items);
                $matched += count($items);
            });

            $expiresAt = now()->timestamp + self::TTL;
            DB::table(self::TASKS)->where('id', $taskId)->update(['matched' => $matched, 'expires_at' => $expiresAt]);
            DB::table(self::TASKS)->where('admin_id', $adminId)->where('id', '<', $taskId)
                ->where('state', 'preview')->update(['state' => 'superseded', 'expires_at' => $now]);
            return [
                'matched' => $matched, 'reviewed' => $reviewed, 'pending' => $matched - $reviewed,
                'excluded_pending' => !$includePending && !$matched ? $inRange->pendingReview()->count() : null,
                'rows' => $rows, 'limit' => self::SAMPLE_LIMIT,
                'token' => $matched ? $token : null, 'expires_at' => $matched ? $expiresAt : null,
            ];
        }, 3);
    }

    public function execute(int $adminId, string $token): array
    {
        return DB::transaction(function () use ($adminId, $token) {
            $task = DB::table(self::TASKS)->where('admin_id', $adminId)->where('token_hash', hash('sha256', $token))
                ->lockForUpdate()->first();
            abort_unless($task, 409, '清理预览已失效，请重新预览。');
            if (in_array($task->state, self::CONFIRMED, true)) {
                return $this->statusData($task);
            }
            abort_unless($task->state === 'preview' && $task->matched > 0 && $task->expires_at > now()->timestamp,
                409, '清理预览已失效，请重新预览。');
            $task->state = 'queued';
            DB::table(self::TASKS)->where('id', $task->id)->update(['state' => 'queued', 'updated_at' => now()->timestamp]);
            return $this->statusData($task);
        }, 3);
    }

    public function status(int $adminId, ?int $taskId = null): ?array
    {
        $query = DB::table(self::TASKS)->where('admin_id', $adminId)->whereIn('state', self::CONFIRMED);
        if ($taskId !== null) {
            $query->where('id', $taskId);
        } else {
            $query->orderByRaw("CASE WHEN state = 'completed' THEN 1 ELSE 0 END");
        }
        $task = $query->orderByDesc('id')->first();
        abort_if(!$task && $taskId !== null, 404);
        return $task ? $this->statusData($task) : null;
    }

    public function retry(int $adminId, int $taskId): array
    {
        return DB::transaction(function () use ($adminId, $taskId) {
            $task = DB::table(self::TASKS)->where('admin_id', $adminId)->where('id', $taskId)->lockForUpdate()->first();
            abort_unless($task && in_array($task->state, self::CONFIRMED, true), 404);
            if ($task->state === 'failed') {
                $task->state = 'queued';
                DB::table(self::TASKS)->where('id', $taskId)->update(['state' => 'queued', 'updated_at' => now()->timestamp]);
            }
            return $this->statusData($task);
        }, 3);
    }

    public function processBatch(int $taskId): bool
    {
        return DB::transaction(function () use ($taskId) {
            $task = DB::table(self::TASKS)->where('id', $taskId)->lockForUpdate()->first();
            if (!$task || !in_array($task->state, ['queued', 'running'], true)) return false;
            $items = DB::table(self::ITEMS)->where('task_id', $taskId);
            $versions = (clone $items)->orderBy('risk_hit_id')->limit(self::BATCH_SIZE)->pluck('version', 'risk_hit_id');
            if ($versions->isEmpty()) throw new \LogicException('Risk cleanup snapshot is incomplete');
            $ids = $versions->keys()->all();
            $hits = RiskRuleHit::query()->whereIntegerInRaw('id', $ids)->orderBy('id')->lockForUpdate();
            $unchanged = [];
            foreach ($hits->cursor() as $hit) {
                if ($versions[$hit->id] === $this->version($hit)) $unchanged[] = $hit->id;
            }
            $deleted = $unchanged ? RiskRuleHit::query()->whereIntegerInRaw('id', $unchanged)->delete() : 0;
            $items->whereIntegerInRaw('risk_hit_id', $ids)->delete();
            $totalDeleted = $task->deleted + $deleted;
            $totalSkipped = $task->skipped + count($ids) - $deleted;
            $more = $totalDeleted + $totalSkipped < $task->matched;
            DB::table(self::TASKS)->where('id', $taskId)->update([
                'state' => $more ? 'running' : 'completed', 'deleted' => $totalDeleted,
                'skipped' => $totalSkipped, 'updated_at' => now()->timestamp,
            ]);
            return $more;
        }, 3);
    }

    public function markFailed(int $taskId): void
    {
        DB::table(self::TASKS)->where('id', $taskId)->whereIn('state', ['queued', 'running'])
            ->update(['state' => 'failed', 'updated_at' => now()->timestamp]);
    }

    public function purgeExpired(): void
    {
        $now = now()->timestamp;
        $deadline = microtime(true) + 3;
        do {
            $purged = DB::transaction(fn () => $this->purgeExpiredBatch($now), 3);
        } while ($purged && microtime(true) < $deadline);
    }

    private function purgeExpiredBatch(int $now): bool
    {
        $task = DB::table(self::TASKS)->where(function ($expired) use ($now) {
            $expired->whereIn('state', ['preview', 'superseded'])->where('expires_at', '<=', $now);
        })->orWhere(function ($finished) use ($now) {
            $finished->where('state', 'completed')->where('updated_at', '<', $now - 7 * 86400);
        })->orderBy('id')->lockForUpdate()->first();
        if (!$task) return false;
        $items = DB::table(self::ITEMS)->where('task_id', $task->id);
        $ids = (clone $items)->orderBy('risk_hit_id')->limit(self::BATCH_SIZE)->pluck('risk_hit_id')->all();
        if ($ids) $items->whereIntegerInRaw('risk_hit_id', $ids)->delete();
        if (count($ids) < self::BATCH_SIZE) DB::table(self::TASKS)->where('id', $task->id)->delete();
        return true;
    }

    private function statusData(object $task): array
    {
        return [
            'id' => (int) $task->id, 'state' => $task->state, 'matched' => (int) $task->matched,
            'deleted' => (int) $task->deleted, 'skipped' => (int) $task->skipped,
        ];
    }

    private function version(RiskRuleHit $hit): string
    {
        // updated_at has second precision. Include evidence and review history for same-second edits.
        return hash('sha256', serialize($hit->getAttributes()));
    }
}
