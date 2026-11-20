<?php

namespace App\Services;

use App\Models\RiskRuleHit;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class RiskHitCleanup
{
    private const LIMIT = 1000;
    private const TTL = 600;

    public function preview(int $adminId, int $before, bool $includePending): array
    {
        $query = RiskRuleHit::query()->where('hit_at', '>', 0)
            ->where('hit_at', '<', min($before, now()->timestamp + 1));
        if (!$includePending) {
            $query->whereIn('payload->review->state', RiskRuleHit::REVIEWED_STATES);
        }
        [$matched, $versions, $reviewed] = DB::transaction(function () use ($query) {
            $matched = $query->count();
            $versions = [];
            $reviewed = 0;
            foreach ($query->orderBy('hit_at')->orderBy('id')->limit(self::LIMIT)->cursor() as $hit) {
                $versions[$hit->id] = $this->version($hit);
                if (in_array(data_get($hit->payload, 'review.state'), RiskRuleHit::REVIEWED_STATES, true)) {
                    $reviewed++;
                }
            }
            return [$matched, $versions, $reviewed];
        });

        $key = $this->key($adminId);
        $token = $versions ? bin2hex(random_bytes(32)) : null;
        $expiresAt = $token ? now()->timestamp + self::TTL : null;
        $this->withLock($key, function () use ($key, $token, $versions, $expiresAt) {
            // Keep at most one bounded snapshot per administrator, including across tabs.
            if ($token === null) {
                Cache::forget($key);
            } else {
                abort_unless(Cache::put($key, [
                    'token' => $token, 'versions' => $versions, 'expires_at' => $expiresAt,
                ], self::TTL), 503, '暂时无法保存清理预览，请稍后重试。');
            }
        });
        return [
            'matched' => $matched, 'reviewed' => $reviewed, 'pending' => count($versions) - $reviewed,
            'limit' => self::LIMIT, 'token' => $token, 'expires_at' => $expiresAt,
        ];
    }

    public function execute(int $adminId, string $token): array
    {
        $key = $this->key($adminId);
        $versions = $this->withLock($key, function () use ($key, $token) {
            $snapshot = Cache::get($key);
            abort_unless($snapshot && $snapshot['expires_at'] > now()->timestamp &&
                hash_equals($snapshot['token'], $token), 409, '清理预览已失效，请重新预览。');
            // Consume before deleting. A lost response or a failed transaction requires a fresh preview.
            abort_unless(Cache::forget($key), 409, '清理预览已失效，请重新预览。');
            return $snapshot['versions'];
        });

        return DB::transaction(function () use ($versions) {
            $unchanged = [];
            $candidates = RiskRuleHit::query()->whereIntegerInRaw('id', array_keys($versions))
                ->orderBy('id')->lockForUpdate();
            foreach ($candidates->cursor() as $hit) {
                if ($versions[$hit->id] === $this->version($hit)) {
                    $unchanged[] = $hit->id;
                }
            }
            $deleted = count($unchanged) ? RiskRuleHit::query()->whereIntegerInRaw('id', $unchanged)->delete() : 0;
            return ['deleted' => $deleted, 'skipped' => count($versions) - $deleted];
        }, 3);
    }

    private function key(int $adminId): string
    {
        return 'risk-hit-cleanup:'.$adminId;
    }

    private function withLock(string $key, \Closure $action): mixed
    {
        try {
            return Cache::lock($key.':lock', 10)->block(3, $action);
        } catch (LockTimeoutException) {
            abort(409, '清理操作正在进行，请刷新后重新预览。');
        }
    }

    private function version(RiskRuleHit $hit): string
    {
        // updated_at has second precision. Include the evidence and review history even for same-second edits.
        return hash('sha256', serialize($hit->getAttributes()));
    }
}
