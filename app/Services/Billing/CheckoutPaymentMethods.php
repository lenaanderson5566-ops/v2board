<?php

namespace App\Services\Billing;

use App\Models\Order;
use App\Models\Payment;
use App\Services\PaymentPresentation;
use App\Services\PaymentQuote;
use App\Services\PaymentService;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class CheckoutPaymentMethods
{
    public static function forOrder(?Order $order): array
    {
        return Payment::select([
            'currency',
            'uuid',
            'id',
            'name',
            'payment',
            'icon',
            'handling_fee_fixed',
            'handling_fee_percent',
            'config',
        ])
            ->where('enable', 1)
            ->whereNotIn(DB::raw('LOWER(payment)'), PaymentService::unavailableForCheckout())
            ->orderBy('sort', 'ASC')
            ->get()
            ->map(function (Payment $method) use ($order): ?array {
                $saved = $order?->payment_snapshot['channels'][(string) $method->id] ?? null;
                if ($saved && (($saved['uuid'] ?? null) !== $method->uuid || ($saved['provider'] ?? null) !== $method->payment)) {
                    return null;
                }

                $fields = PaymentPresentation::fields($method->config ?? []);
                if ($order && $order->total_amount > 0) {
                    try {
                        $quote = PaymentQuote::make($order, $method);
                    } catch (HttpException $error) {
                        if (!in_array($error->getStatusCode(), [422, 503], true)) {
                            throw $error;
                        }
                        return null;
                    }
                    $fields += [
                        'quoted_amount' => $quote['payment_amount'],
                        'quoted_currency' => $quote['payment_currency'],
                        'quoted_fee' => $quote['handling_amount'],
                        'rate_time' => $quote['fx']['quotedAt'] ?? null,
                    ];
                }

                return array_merge($method->makeHidden(['config', 'uuid'])->toArray(), $fields);
            })
            ->filter()
            ->values()
            ->all();
    }
}
