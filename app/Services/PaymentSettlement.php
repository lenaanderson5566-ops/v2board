<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;

final class PaymentSettlement
{
    public static function validate(Order $order, Payment $payment, array $verified): ?array
    {
        $snapshot = $order->payment_snapshot['channels'][(string)$payment->id] ?? null;
        if (!$snapshot && !isset($order->payment_snapshot['channels']) && (int)$order->payment_id === (int)$payment->id
            && isset($order->payment_snapshot['uuid'], $order->payment_snapshot['provider'])) $snapshot = $order->payment_snapshot;
        if (!$snapshot && (isset($order->payment_snapshot['channels']) || (int)$order->payment_id !== (int)$payment->id)) abort(500, 'channel mismatch');
        if ($snapshot && ($snapshot['uuid'] !== $payment->uuid || $snapshot['provider'] !== $payment->payment)) abort(500, 'channel mismatch');
        $expected = $snapshot['payment_amount'] ?? ((int)$order->total_amount + (int)($snapshot['handling_amount'] ?? $order->handling_amount));
        if (!isset($verified['amount'], $verified['currency']) || !is_int($verified['amount']) || !is_string($verified['currency'])
            || $verified['amount'] !== $expected || strtoupper($verified['currency']) !== ($snapshot['payment_currency'] ?? ($order->currency ?: 'CNY'))) {
            abort(500, 'payment amount mismatch');
        }
        return $snapshot;
    }
}
