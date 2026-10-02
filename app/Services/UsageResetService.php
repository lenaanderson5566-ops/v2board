<?php
namespace App\Services;

use App\Models\User;
use App\Models\Plan;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Exceptions\HttpResponseException;

class UsageResetService
{
    private function fail(string $code): void
    {
        throw new HttpResponseException(response()->json(['message' => $code, 'code' => $code], 422));
    }

    public function available(int $userId)
    {
        return DB::table('v2_usage_reset_credit')->where('user_id', $userId)->where('remaining', '>', 0)
            ->where(function ($q) { $q->whereNull('expires_at')->orWhere('expires_at', '>', time()); });
    }

    public function summary(int $userId): array
    {
        $user = User::findOrFail($userId);
        $credits = $this->available($userId)->orderByRaw('expires_at IS NULL')->orderBy('expires_at')->orderBy('id')->get();
        $valid = !$user->banned && $user->plan_id && Plan::where('id', $user->plan_id)->exists()
            && ($user->expired_at === null || $user->expired_at > time()) && $user->transfer_enable > 0;
        $reason = !$valid ? 'reset_inactive' : (($user->u + $user->d) <= 0 ? 'reset_empty' : ($credits->sum('remaining') <= 0 ? 'reset_no_credit' : null));
        return [
            'available' => (int)$credits->sum('remaining'),
            'credits' => $credits->map(function ($c) { return ['id' => $c->id, 'remaining' => $c->remaining, 'expires_at' => $c->expires_at]; }),
            'can_reset' => $reason === null, 'disabled_reason' => $reason,
            'history' => DB::table('v2_usage_reset_log')->where('user_id', $userId)
                ->where('created_at', '>=', time() - 30 * 86400)->orderByDesc('id')->limit(100)
                ->get(['id', 'kind', 'quantity', 'u_before', 'd_before', 'created_at']),
        ];
    }

    public function consume(int $userId, string $key): array
    {
        return DB::transaction(function () use ($userId, $key) {
            // Serialize resets for this account; never trust browser eligibility or counters.
            $user = User::where('id', $userId)->lockForUpdate()->firstOrFail();
            if (DB::table('v2_usage_reset_log')->where('user_id', $userId)->where('request_key', $key)->exists()) {
                return ['outcome' => 'already_redeemed'];
            }
            if ($user->banned || !$user->plan_id || !Plan::where('id', $user->plan_id)->exists()
                || ($user->expired_at !== null && $user->expired_at <= time()) || $user->transfer_enable <= 0) $this->fail('reset_inactive');
            if ($user->u + $user->d <= 0) $this->fail('reset_empty');
            $credit = $this->available($userId)->orderByRaw('expires_at IS NULL')->orderBy('expires_at')->orderBy('id')->lockForUpdate()->first();
            if (!$credit) $this->fail('reset_no_credit');
            DB::table('v2_usage_reset_credit')->where('id', $credit->id)->decrement('remaining');
            DB::table('v2_usage_reset_log')->insert([
                'user_id' => $userId, 'actor_id' => $userId, 'credit_id' => $credit->id, 'batch_id' => $credit->batch_id,
                'kind' => 'use', 'quantity' => -1, 'u_before' => $user->u, 'd_before' => $user->d,
                'request_key' => $key, 'created_at' => time(),
            ]);
            // Only reset usage: preserve the plan, quota, credentials and all renewal dates.
            $user->update(['u' => 0, 'd' => 0]);
            return ['outcome' => 'reset'];
        }, 3);
    }

    public function batch($users, int $actorId, array $data): array
    {
        return DB::transaction(function () use ($users, $actorId, $data) {
            $hash = hash('sha256', json_encode(array_diff_key($data, ['request_key' => true])));
            // A unique row arbitrates retries, including concurrent submissions from different admins.
            DB::table('v2_usage_reset_batch')->insertOrIgnore([
                'request_key' => $data['request_key'], 'actor_id' => $actorId, 'kind' => $data['kind'],
                'payload_hash' => $hash, 'created_at' => time(),
            ]);
            $batch = DB::table('v2_usage_reset_batch')->where('request_key', $data['request_key'])->lockForUpdate()->first();
            if ($batch->actor_id !== $actorId || $batch->payload_hash !== $hash) $this->fail('reset_request_conflict');
            if ($batch->affected > 0) return ['affected' => $batch->affected, 'replayed' => true];
            if ((clone $users)->count() !== (int)$data['expected_count']) $this->fail('reset_count_changed');
            $affected = 0;
            $users->orderBy('id')->lockForUpdate()->chunkById(500, function ($chunk) use (&$affected, $actorId, $data, $batch) {
                foreach ($chunk as $user) {
                    $beforeU = $user->u;
                    $beforeD = $user->d;
                    $creditId = null;
                    if ($data['kind'] === 'grant') {
                        $creditId = DB::table('v2_usage_reset_credit')->insertGetId([
                            'user_id' => $user->id, 'batch_id' => $batch->id, 'quantity' => $data['quantity'],
                            'remaining' => $data['quantity'], 'expires_at' => $data['expires_at'] ?? null, 'created_at' => time(),
                        ]);
                    } else {
                        $user->update(['u' => 0, 'd' => 0]);
                    }
                    DB::table('v2_usage_reset_log')->insert([
                        'user_id' => $user->id, 'actor_id' => $actorId, 'credit_id' => $creditId, 'batch_id' => $batch->id,
                        'kind' => $data['kind'], 'quantity' => $data['kind'] === 'grant' ? $data['quantity'] : 0,
                        'u_before' => $beforeU, 'd_before' => $beforeD, 'created_at' => time(),
                    ]);
                    $affected++;
                }
            });
            if ($affected !== (int)$data['expected_count']) $this->fail('reset_count_changed');
            DB::table('v2_usage_reset_batch')->where('id', $batch->id)->update(['affected' => $affected]);
            return ['affected' => $affected, 'replayed' => false];
        }, 3);
    }
}
