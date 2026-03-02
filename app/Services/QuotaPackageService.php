<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\User;
use App\Models\UserQuotaPackage;

class QuotaPackageService
{
    public function grantByOnetimeOrder(User $user, int $bytes, ?int $orderId = null, ?int $planId = null): void
    {
        if ($bytes <= 0) {
            return;
        }

        UserQuotaPackage::create([
            'user_id' => $user->id,
            'order_id' => $orderId,
            'plan_id' => $planId,
            'total_bytes' => $bytes,
            'used_bytes' => 0,
            'remaining_bytes' => $bytes,
            'source' => 'onetime_price',
        ]);
    }

    public function consume(User $user, int $bytes): void
    {
        if ($bytes <= 0) {
            return;
        }

        $pools = UserQuotaPackage::where('user_id', $user->id)
            ->where('remaining_bytes', '>', 0)
            ->orderBy('id', 'asc')
            ->lockForUpdate()
            ->get();

        foreach ($pools as $pool) {
            if ($bytes <= 0) {
                break;
            }

            $cost = (int) min($bytes, $pool->remaining_bytes);
            if ($cost <= 0) {
                continue;
            }

            $pool->used_bytes += $cost;
            $pool->remaining_bytes -= $cost;
            $pool->save();
            $bytes -= $cost;
        }
    }

    public function getRemainingBytes(int $userId): int
    {
        return (int) UserQuotaPackage::where('user_id', $userId)
            ->where('remaining_bytes', '>', 0)
            ->sum('remaining_bytes');
    }

    public function syncUserTransferEnable(User $user): void
    {
        $baseBytes = $this->getCurrentBaseQuotaBytes($user);
        $packageBytes = $this->getRemainingBytes($user->id);
        $user->transfer_enable = $baseBytes + $packageBytes;
        $user->save();
    }

    public function getCurrentBaseQuotaBytes(User $user): int
    {
        if (!$user->plan_id) {
            return 0;
        }

        if ($user->expired_at !== null && $user->expired_at <= time()) {
            return 0;
        }

        $plan = Plan::find($user->plan_id);
        if (!$plan) {
            return 0;
        }

        return max((int) $plan->transfer_enable, 0) * 1073741824;
    }
}
