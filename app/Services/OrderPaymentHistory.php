<?php
namespace App\Services;
use App\Models\Order;
use App\Models\Payment;
class OrderPaymentHistory {
    public static function capture(Payment $payment): array {
        $fields = PaymentPresentation::fields($payment->config ?? []);
        return array_merge(['name' => $payment->name, 'provider' => $payment->payment],
            array_intersect_key($fields, array_flip(['category', 'asset', 'network', 'network_name'])));
    }
    // One immutable snapshot per chosen channel, not a payment-attempt log.
    public static function select(Order $order, Payment $payment): bool {
        $channels = $order->payment_snapshot['channels'] ?? [];
        $key = (string)$payment->id;
        if (!isset($channels[$key])) {
            $channels[$key] = self::capture($payment) + ['uuid' => $payment->uuid, 'handling_amount' => (int)$order->handling_amount];
        }
        if ((int)$channels[$key]['handling_amount'] !== (int)$order->handling_amount) abort(409, __('Payment method is not available'));
        $order->handling_amount = $channels[$key]['handling_amount'];
        $order->payment_snapshot = $channels[$key] + ['channels' => $channels];
        return $order->save();
    }
    public static function display(Order $order, ?Payment $current = null): string {
        if ($order->callback_no === 'manual_operation') return '人工确认';
        if ((int)$order->total_amount === 0) return (int)$order->balance_amount > 0 ? '余额抵扣 / 无需外部付款' : '无需外部付款';
        $snapshot = $order->payment_snapshot;
        $historical = is_array($snapshot);
        if (!$historical && $current) $snapshot = self::capture($current);
        if (!$snapshot) return $order->payment_id ? '渠道已删除（无历史快照）' : '尚未选择';
        $name = $snapshot['name'] ?? '未知渠道';
        if (($snapshot['category'] ?? '') === 'crypto') $name .= ' · ' . ($snapshot['asset'] ?? '') . ' · ' . ($snapshot['network_name'] ?? $snapshot['network'] ?? '');
        return $name . ($historical ? '' : '（当前渠道信息）');
    }
}
