<?php

namespace App\Services;

use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;

final class AdminRecurringOrderHistory
{
    /** @param Collection<int, User> $users */
    public static function append(Collection $users): void
    {
        $withoutExpiry = $users->filter(static function (User $user): bool {
            $attributes = $user->getAttributes();
            return array_key_exists('expired_at', $attributes)
                && in_array($attributes['expired_at'], [0, '0', null], true);
        });
        if ($withoutExpiry->isEmpty()) {
            return;
        }

        // Even a free or manually opened term is evidence of an earlier recurring order.
        $recorded = Order::query()
            ->whereIn('user_id', $withoutExpiry->pluck('id'))
            ->whereIn('period', array_keys(OrderService::STR_TO_TIME))
            ->whereIn('status', [1, 3, 4])
            ->where(function ($query) {
                $query->whereNull('credit_bytes')->orWhere('credit_bytes', 0);
            })
            ->distinct()->pluck('user_id')->flip();

        foreach ($withoutExpiry as $user) {
            $user['has_recurring_order_history'] = $recorded->has($user->id);
        }
    }
}
