<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;

final class AdminOrderPurchaseStage
{
    /** @param Collection<int, Order> $orders */
    public static function append(Collection $orders): void
    {
        if ($orders->isEmpty()) {
            return;
        }

        // A legacy completed order without a payment time can make a first purchase uncertain.
        $undatedPurchases = RecurringOrderPurchase::valuedWithConfirmedStatus('h')
            ->whereColumn('h.user_id', 'o.user_id')
            ->whereColumn('h.created_at', '<=', 'o.paid_at')
            ->where(function (Builder $query) {
                $query->whereNull('h.paid_at')->orWhere('h.paid_at', '<=', 0);
            })
            ->selectRaw('1')->limit(1);
        $purchases = RecurringOrderPurchase::valued()
            ->whereIn('o.id', $orders->pluck('id'))
            ->select('o.id', 'o.paid_at')
            ->selectSub(RecurringOrderPurchase::prior()->select('p.paid_at')
                ->orderByDesc('p.paid_at')->orderByDesc('p.id')->limit(1), 'prior_paid_at')
            ->selectSub($undatedPurchases, 'has_undated_purchase')
            ->get()->keyBy('id');

        foreach ($orders as $order) {
            $purchase = $purchases->get($order->id);
            if (!$purchase || (int) $purchase->paid_at !== (int) $order->paid_at) {
                continue;
            }
            if ($purchase->prior_paid_at === null) {
                if (!$purchase->has_undated_purchase) {
                    $order['purchase_stage'] = 'first_purchase';
                }
                continue;
            }

            $previousExpiry = (int) $order->previous_subscription_expires_at;
            $createdAt = (int) $order->getRawOriginal('created_at');
            // Both the earlier payment and the expiry must precede this checkout.
            if ($previousExpiry > 0 && $previousExpiry <= $createdAt
                && (int) $purchase->prior_paid_at <= $previousExpiry) {
                $order['purchase_stage'] = 'expired_repurchase';
                $order['repurchase_gap_days'] = intdiv($createdAt - $previousExpiry, 86400);
            }
        }
    }
}
