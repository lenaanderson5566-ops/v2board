<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class PaymentCallbackHistory
{
    public const TABLE = 'v2_payment_callback_event';
    public const REASONS = ['gate is not found', 'Payment channel not found', 'gate is not enable', 'verify error', 'handle error', 'order is not found', 'channel mismatch', 'payment amount mismatch'];
    private const UNVERIFIED_SAMPLE_SECONDS = 60;
    private const UNVERIFIED_RAW_BYTES = 8192;

    public static function record(string $provider, string $uuid, ?string $verifiedTradeNo, string $stage, string $result, ?string $reason, ?string $requestId, ?PaymentGatewayTrace $trace = null): bool
    {
        $unverifiedFailure = $result === 'failed' && $stage !== 'settlement';
        $sampled = false;
        try {
            $payment = Payment::where('uuid', $uuid)->where('payment', $provider)->first();
            if ($unverifiedFailure) {
                // Unknown provider names and endpoint IDs must not create new buckets.
                $bucket = $payment?->id ?? 'unknown';
                $sampled = Cache::add('payment:callback:unverified:'.$bucket, true, self::UNVERIFIED_SAMPLE_SECONDS);
                if (!$sampled) return false;
            }
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
            ] + ($payment ? ($trace?->storageFields(self::TABLE, $unverifiedFailure ? self::UNVERIFIED_RAW_BYTES : null) ?? []) : []));
            return true;
        } catch (\Throwable $error) {
            // Diagnostic storage must never change the provider acknowledgement or settlement.
            // A failed sampling cache must not turn every invalid callback into a log write.
            if ($unverifiedFailure && !$sampled) return false;
            try {
                \Illuminate\Support\Facades\Log::warning('Payment callback history unavailable');
            } catch (\Throwable) {
                // Ignore failures of the diagnostic log sink as well.
            }
            return false;
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
