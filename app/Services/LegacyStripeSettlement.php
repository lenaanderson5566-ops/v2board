<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;

final class LegacyStripeSettlement
{
    public static function payment(array $order, array $config): array
    {
        $currency = strtoupper((string)($config['currency'] ?? 'CNY'));
        abort_unless(in_array($currency, ['CNY','USD'], true) && $currency === strtoupper((string)($order['currency'] ?? 'CNY')), 422, 'Payment currency does not match the saved quote');
        return ['amount'=>Money::parseMinorUnits($order['total_amount']), 'currency'=>strtolower($currency)];
    }

    public static function source($source, array $config): ?array
    {
        $metadata = json_decode(json_encode($source->metadata ?? []), true);
        abort_unless(is_array($metadata) && is_string($metadata['out_trade_no'] ?? null), 400, 'Invalid source metadata');
        $order = Order::where('trade_no', $metadata['out_trade_no'])->firstOrFail();
        $payment = Payment::findOrFail($config['id'] ?? 0);
        abort_unless($payment->uuid === ($config['uuid'] ?? null) && in_array($payment->payment, PaymentQuote::LEGACY_STRIPE, true), 400, 'channel mismatch');
        $amount = Money::parseMinorUnits($source->amount ?? null);
        $currency = strtoupper((string)($source->currency ?? ''));
        PaymentSettlement::validate($order, $payment, ['amount'=>$amount, 'currency'=>$currency]);
        abort_unless((int)($metadata['user_id'] ?? 0) === (int)$order->user_id, 400, 'Invalid source owner');
        if ((int)$order->status !== 0) return null;
        return ['amount'=>$amount, 'currency'=>strtolower($currency), 'source'=>$source->id, 'metadata'=>$metadata];
    }
}
