<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Support\Collection;

final class AdminOrderPurchaseStage
{
    private const UNCONFIRMED_STATUSES = [0, 2];

    /** @param Collection<int, Order> $orders */
    public static function append(Collection $orders): void
    {
        $checkouts = $orders->filter(static fn (Order $order) =>
            (int)$order->type === 1 && in_array((int)$order->status, self::UNCONFIRMED_STATUSES, true));
        if ($checkouts->isNotEmpty()) {
            self::appendCheckoutContext($checkouts);
        }
        $orders = $orders->filter(static fn (Order $order) =>
            in_array((int)$order->status, RecurringOrderPurchase::CONFIRMED_STATUSES, true) && (int)$order->paid_at > 0);
        if ($orders->isEmpty()) {
            return;
        }

        // A legacy completed order without a payment time can make a first purchase uncertain.
        $undatedPurchases = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::potentiallyPriorUndated(), 'h')
            ->selectRaw('1')->limit(1);
        $prior = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::prior(), 'p');
        $purchases = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::valued(), 'o')
            ->whereIn('o.id', $orders->pluck('id'))
            ->select('o.id', 'o.paid_at')
            ->selectSub($prior->select('p.paid_at')
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
            $priorPaidAt = (int) $purchase->prior_paid_at;
            $order['purchase_stage'] = 'repeat_purchase';
            $order['repurchase_expiry_status'] = 'unknown';
            // Both the earlier payment and the expiry must precede this checkout.
            if ($createdAt > 0 && $previousExpiry > 0 && $previousExpiry <= $createdAt
                && $priorPaidAt <= $previousExpiry) {
                $order['purchase_stage'] = 'expired_repurchase';
                $order['repurchase_expiry_status'] = 'expired';
                $order['repurchase_gap_days'] = intdiv($createdAt - $previousExpiry, 86400);
            } elseif ($createdAt > 0 && $previousExpiry > $createdAt && $priorPaidAt <= $createdAt) {
                $order['repurchase_expiry_status'] = 'not_expired';
            }
        }
    }

    private static function appendCheckoutContext(Collection $orders): void
    {
        $prior = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::prior(atCheckout: true), 'p');
        $undated = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::potentiallyPriorUndated(atCheckout: true), 'h');
        $checkouts = RecurringOrderPurchase::requiringManualEvidence(RecurringOrderPurchase::valuedTerm(), 'o')
            ->whereIn('o.id', $orders->pluck('id'))->whereIn('o.status', self::UNCONFIRMED_STATUSES)->where('o.type', 1)
            ->select('o.id', 'o.user_id', 'o.status', 'o.created_at')
            ->selectSub($prior->selectRaw('1')->limit(1), 'has_prior_purchase')
            ->selectSub($undated->selectRaw('1')->limit(1), 'has_undated_purchase')
            ->get()->keyBy('id');

        foreach ($orders as $order) {
            $row = $checkouts->get($order->id);
            if (!$row || (int)$row->status !== (int)$order->status || (int)$row->user_id !== (int)$order->user_id ||
                (int)$row->created_at !== (int)$order->getRawOriginal('created_at')) {
                continue;
            }
            $order['checkout_purchase_context'] = match (true) {
                (int)$row->created_at <= 0 => 'unknown',
                (bool)$row->has_prior_purchase => 'repeat',
                (bool)$row->has_undated_purchase => 'unknown',
                default => 'new',
            };
            if ((int)$row->status === 0) {
                $order['pending_purchase_context'] = $order['checkout_purchase_context'];
            }
        }
    }
}
