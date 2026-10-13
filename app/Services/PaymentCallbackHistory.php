<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class PaymentCallbackHistory
{
    public const REASONS = ['gate is not found', 'Payment channel not found', 'gate is not enable', 'verify error', 'handle error', 'order is not found', 'channel mismatch', 'payment amount mismatch'];

    public static function record(string $provider, string $uuid, ?string $verifiedTradeNo, string $stage, string $result, ?string $reason, ?string $requestId): void
    {
        try {
            $payment = Payment::where('uuid', $uuid)->where('payment', $provider)->first();
            $order = $verifiedTradeNo ? Order::where('trade_no', $verifiedTradeNo)->first() : null;
            $associated = $payment && $order && ((int) $order->payment_id === (int) $payment->id
                || isset($order->payment_snapshot['channels'][(string) $payment->id]));
            DB::table('v2_payment_callback_event')->insert([
                'order_id' => $associated ? $order->id : null,
                'payment_id' => $payment?->id,
                'provider' => $payment ? $payment->payment : 'unknown',
                'stage' => $stage,
                'result' => $result,
                'reason' => $reason === null ? null : (in_array($reason, self::REASONS, true) ? $reason : 'internal_error'),
                'request_id' => is_string($requestId) && \Illuminate\Support\Str::isUuid($requestId) ? $requestId : null,
                'created_at' => time(),
            ]);
        } catch (\Throwable $error) {
            // Diagnostic storage must never change the provider acknowledgement or settlement.
            \Illuminate\Support\Facades\Log::warning('Payment callback history unavailable');
        }
    }

    public static function forOrder(Order $order): array
    {
        if (!Schema::hasTable('v2_payment_callback_event')) return ['available' => false, 'events' => [], 'channelEvents' => []];
        $columns = ['id', 'provider', 'stage', 'result', 'reason', 'request_id', 'created_at'];
        $channels = array_keys($order->payment_snapshot['channels'] ?? []);
        if ($order->payment_id) $channels[] = $order->payment_id;
        return [
            'available' => true,
            'events' => DB::table('v2_payment_callback_event')->where('order_id', $order->id)->orderByDesc('id')->limit(20)->get($columns),
            'channelEvents' => DB::table('v2_payment_callback_event')->whereNull('order_id')->whereIn('payment_id', $channels)
                ->where('created_at', '>=', max(time() - 86400, (int) $order->created_at))->orderByDesc('id')->limit(10)->get($columns),
        ];
    }
}
