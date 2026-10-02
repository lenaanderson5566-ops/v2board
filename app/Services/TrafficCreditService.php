<?php
namespace App\Services;

use App\Models\User;
use App\Models\Order;
use Illuminate\Support\Facades\DB;

class TrafficCreditService
{
    // A null expiry is the legacy permanent, non-resetting traffic entitlement.
    // Keep its access profile and credentials; move only its unspent bytes.
    public function migrateUser(User $user): void
    {
        if ($user->credit_migrated_at || $user->expired_at !== null || !$user->plan_id || $user->transfer_enable <= 0) return;
        // An already quoted legacy switch may exchange this allowance for money.
        // Defer its conversion until fulfillment/cancellation so it cannot be counted twice.
        if (Order::where('user_id', $user->id)->whereIn('status', [0, 1])->whereNull('credit_bytes')
            ->where('period', '!=', 'deposit')->exists()) return;
        $remaining = max(0, (int)$user->transfer_enable - (int)$user->u - (int)$user->d);
        DB::table('v2_traffic_credit_log')->insert([
            'user_id' => $user->id, 'reference' => 'legacy:'.$user->id,
            'bytes' => $remaining, 'kind' => 'migration',
            'snapshot' => json_encode($user->only(['transfer_enable','u','d','plan_id','group_id','expired_at','speed_limit','device_limit'])),
            'created_at' => time(),
        ]);
        $user->credit_balance = (int)$user->credit_balance + $remaining;
        $user->credit_migrated_at = time();
        $user->transfer_enable = 0;
    }

    public function fulfill(Order $original): void
    {
        DB::transaction(function () use ($original) {
            $order = Order::where('id', $original->id)->lockForUpdate()->firstOrFail();
            if ((int)$order->status !== 1) return;
            $user = User::where('id', $order->user_id)->lockForUpdate()->firstOrFail();
            $snapshot = $order->credit_snapshot;
            if ((int)$order->credit_bytes <= 0 || !is_array($snapshot)) throw new \RuntimeException('Invalid credit order snapshot');
            $this->migrateUser($user);
            // Credits extend the existing access profile. A first purchase establishes it.
            if (!$user->plan_id || $user->group_id === null) {
                $user->plan_id = $order->plan_id;
                $user->group_id = $snapshot['group_id'];
                $user->speed_limit = $snapshot['speed_limit'];
                $user->device_limit = $snapshot['device_limit'];
            }
            $user->credit_balance = (int)$user->credit_balance + (int)$order->credit_bytes;
            $user->save();
            DB::table('v2_traffic_credit_log')->insert([
                'user_id' => $user->id, 'reference' => 'order:'.$order->id,
                'bytes' => $order->credit_bytes, 'kind' => 'purchase',
                'snapshot' => json_encode($snapshot), 'created_at' => time(),
            ]);
            $order->status = 3;
            $order->save();
        }, 3);
    }

    public static function hasPeriod(User $user): bool
    {
        return $user->transfer_enable > 0 && ($user->expired_at === null || $user->expired_at > time());
    }

    // A copy for client quota headers only; never save these derived fields.
    public static function forClient(User $user): User
    {
        $copy = clone $user;
        if ($user->credit_balance > 0) {
            $base = self::hasPeriod($user) ? (int)$user->transfer_enable : 0;
            $copy->transfer_enable = max($base, (int)$user->u + (int)$user->d) + (int)$user->credit_balance;
            // Clients must not disable independent credits because a plan has expired.
            $copy->expired_at = null;
        }
        return $copy;
    }
}
