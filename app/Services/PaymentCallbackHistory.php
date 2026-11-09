<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class PaymentCallbackHistory
{
    public const TABLE = 'v2_payment_callback_event';
    public const REASONS = ['gate is not found', 'Payment channel not found', 'gate is not enable', 'verify error', 'handle error', 'order is not found', 'channel mismatch', 'payment amount mismatch'];

    public static function record(string $provider, string $uuid, ?string $verifiedTradeNo, string $stage, string $result, ?string $reason, ?string $requestId, ?PaymentGatewayTrace $trace = null): void
    {
        try {
            $payment = Payment::where('uuid', $uuid)->where('payment', $provider)->first();
            $order = $verifiedTradeNo ? Order::where('trade_no', $verifiedTradeNo)->first() : null;
            $associated = $payment && $order && ((int) $order->payment_id === (int) $payment->id
                || isset($order->payment_snapshot['channels'][(string) $payment->id]));
            DB::table(self::TABLE)->insert([
                'order_id' => $associated ? $order->id : null,
                'payment_id' => $payment?->id,
                'provider' => $payment ? $payment->payment : 'unknown',
                'stage' => $stage,
                'result' => $result,
                'reason' => $reason === null ? null : (in_array($reason, self::REASONS, true) ? $reason : 'internal_error'),
                'request_id' => is_string($requestId) && \Illuminate\Support\Str::isUuid($requestId) ? $requestId : null,
                'created_at' => time(),
            ] + ($payment ? ($trace?->storageFields(self::TABLE) ?? []) : []));
        } catch (\Throwable $error) {
            // Diagnostic storage must never change the provider acknowledgement or settlement.
            try {
                \Illuminate\Support\Facades\Log::warning('Payment callback history unavailable');
            } catch (\Throwable) {
                // Ignore failures of the diagnostic log sink as well.
            }
        }
    }

    public static function forOrder(Order $order): array
    {
        if (!Schema::hasTable(self::TABLE)) return ['available' => false, 'events' => [], 'channelEvents' => []];
        $channels = array_keys($order->payment_snapshot['channels'] ?? []);
        if ($order->payment_id) $channels[] = $order->payment_id;
        $events = self::events();
        return [
            'available' => true,
            'events' => (clone $events)->where('order_id', $order->id)->limit(20)->get()->each(self::castAvailability(...)),
            'channelEvents' => $events->whereNull('order_id')->whereIn('payment_id', $channels)
                ->where('created_at', '>=', max(time() - 86400, (int) $order->created_at))->limit(10)->get()->each(self::castAvailability(...)),
        ];
    }

    public static function forChannel(int $paymentId): Collection
    {
        if (!Schema::hasTable(self::TABLE)) return collect();
        return self::events()->leftJoin('v2_order as orders', 'orders.id', '=', self::TABLE . '.order_id')
            ->addSelect('orders.trade_no')
            ->where(self::TABLE . '.payment_id', $paymentId)->where(self::TABLE . '.created_at', '>=', time() - 3600)
            ->limit(20)->get()->each(self::castAvailability(...));
    }

    private static function events(): Builder
    {
        $columns = array_map(fn (string $column) => self::TABLE . '.' . $column,
            ['id', 'provider', 'stage', 'result', 'reason', 'request_id', 'created_at']);
        return PaymentGatewayTrace::selectAvailability(DB::table(self::TABLE)->select($columns), self::TABLE)
            ->orderByDesc(self::TABLE . '.id');
    }

    private static function castAvailability(object $event): void
    {
        $event->has_raw_diagnostic = (bool) $event->has_raw_diagnostic;
    }
}
