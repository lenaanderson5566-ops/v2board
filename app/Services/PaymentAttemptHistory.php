<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

final class PaymentAttemptHistory
{
    public const TABLE = 'v2_payment_attempt_event';
    private const REASONS = [
        'order_closed', 'invalid_amount', 'channel_unavailable', 'quote_changed', 'quote_expired',
        'in_flight', 'request_key_conflict', 'invalid_config', 'missing_credentials', 'currency_mismatch',
        'gateway_result_unknown', 'dns_failed', 'connection_failed', 'tls_failed', 'gateway_timeout',
        'transport_failed', 'gateway_http_error', 'invalid_response', 'gateway_rejected',
        'missing_payment_action', 'internal_error',
    ];

    private ?int $orderId = null;
    private ?int $paymentId = null;
    private string $stage = 'preflight';
    private string $reason = 'internal_error';
    private ?string $previousRequestId = null;
    private array $gateway = [];
    private ?PaymentGatewayTrace $trace = null;
    private ?int $startedAt = null;

    public function __construct(private readonly ?string $requestId) {}

    public function identify(Order $order, int $paymentId): void
    {
        $this->orderId = $order->id;
        $this->paymentId = $paymentId > 0 ? $paymentId : null;
    }

    public function checkpoint(string $reason): void
    {
        $this->reason = $reason;
    }

    public function gatewayRejected(): bool
    {
        return $this->stage === 'gateway' && $this->reason === 'gateway_rejected';
    }

    public function previous(array $attempt): void
    {
        $this->previousRequestId = self::uuid($attempt['request_id'] ?? null);
    }

    public function provider(): PaymentGatewayTrace
    {
        $this->stage = 'provider';
        $this->reason = 'gateway_result_unknown';
        $this->startedAt = hrtime(true);
        return $this->trace = new PaymentGatewayTrace();
    }

    public function sending(string $url): void
    {
        $this->stage = 'gateway';
        $this->startedAt = hrtime(true);
        $this->gatewayHost($url);
    }

    private function gatewayHost(string $url): void
    {
        $host = parse_url($url, PHP_URL_HOST);
        if (is_string($host) && filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
            $this->gateway['gateway_host'] = strtolower($host);
        }
    }

    public function received(object $curl, mixed $code, mixed $gatewayOrder, mixed $actions): void
    {
        if ($this->startedAt !== null) $this->gateway['duration_ms'] = (int) ((hrtime(true) - $this->startedAt) / 1000000);
        $status = (int) ($curl->httpStatusCode ?? 0);
        if ($status >= 100 && $status <= 599) $this->gateway['gateway_http_status'] = $status;
        if ((is_int($code) || is_string($code)) && preg_match('/\A-?[0-9]{1,9}\z/D', (string) $code)) {
            $this->gateway['gateway_code'] = (int) $code;
        }
        if ((is_int($gatewayOrder) || is_string($gatewayOrder)) && preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/D', (string) $gatewayOrder)) {
            $this->gateway['gateway_order'] = (string) $gatewayOrder;
        }
        $fields = [];
        foreach (['qrcode', 'urlscheme', 'payurl', 'pay_url'] as $field) {
            if (is_string($actions->{$field} ?? null) && $actions->{$field} !== '') $fields[] = $field;
        }
        if ($fields) $this->gateway['gateway_actions'] = implode(', ', $fields);
        $this->reason = match ((int) ($curl->curlErrorCode ?? 0)) {
            5, 6 => 'dns_failed',
            7 => 'connection_failed',
            28 => 'gateway_timeout',
            35, 51, 58, 59, 60, 77, 83, 90, 91 => 'tls_failed',
            0 => $status >= 400 ? 'gateway_http_error' : 'invalid_response',
            default => 'transport_failed',
        };
    }

    public function finish(string $result): void
    {
        if (!$this->orderId || $result === 'replayed') return;

        try {
            $provider = $this->paymentId ? Payment::whereKey($this->paymentId)->value('payment') : null;
            $exchange = $this->trace?->lastExchange();
            if ($exchange !== null && $this->stage === 'provider') {
                $this->stage = 'gateway';
                $this->gatewayHost($exchange['url']);
                if ($exchange['status'] >= 100 && $exchange['status'] <= 599) {
                    $this->gateway['gateway_http_status'] = $exchange['status'];
                    if ($exchange['status'] >= 400 && $this->reason === 'gateway_result_unknown') $this->reason = 'gateway_http_error';
                }
            }
            DB::table(self::TABLE)->insert($this->gateway + ($this->trace?->storageFields(self::TABLE) ?? []) + [
                'order_id' => $this->orderId,
                'payment_id' => $provider === null ? null : $this->paymentId,
                'provider' => $provider,
                'stage' => $this->stage,
                'result' => $result,
                'reason' => in_array($result, ['failed', 'blocked'], true)
                    ? (in_array($this->reason, self::REASONS, true) ? $this->reason : 'internal_error') : null,
                'request_id' => self::uuid($this->requestId),
                'previous_request_id' => $this->previousRequestId,
                'duration_ms' => $this->startedAt === null ? null : (int) ((hrtime(true) - $this->startedAt) / 1000000),
                'created_at' => time(),
            ]);
        } catch (\Throwable $error) {
            self::diagnosticUnavailable($this->requestId);
        }
    }

    private static function diagnosticUnavailable(?string $requestId): void
    {
        try {
            Log::warning('Payment attempt diagnostics unavailable', ['requestId' => self::uuid($requestId)]);
        } catch (\Throwable $loggingError) {
            // Diagnostics must not change the checkout response even if logging is unavailable.
        }
    }

    private static function uuid(mixed $value): ?string
    {
        return is_string($value) && Str::isUuid($value) ? $value : null;
    }

    public static function hasFailed(Order $order, array $attempt): bool
    {
        $requestId = self::uuid($attempt['request_id'] ?? null);
        return $requestId !== null && Schema::hasTable(self::TABLE)
            && DB::table(self::TABLE)->where('order_id', $order->id)->where('request_id', $requestId)
                ->where('result', 'failed')->whereIn('stage', ['provider', 'gateway'])->exists();
    }

    public static function forOrder(Order $order): array
    {
        if (!Schema::hasTable(self::TABLE)) return ['available' => false, 'events' => []];

        return [
            'available' => true,
            'events' => self::events(DB::table(self::TABLE)->where('order_id', $order->id)
                ->orderByDesc('created_at')->orderByDesc('id')->limit(20), [
                    'id', 'provider', 'payment_id', 'stage', 'result', 'reason', 'request_id', 'previous_request_id',
                    'gateway_host', 'gateway_http_status', 'gateway_code', 'gateway_order', 'gateway_actions', 'duration_ms', 'created_at',
                ]),
        ];
    }

    public static function recentFailures(): ?array
    {
        if (!Schema::hasTable(self::TABLE)) return null;

        return self::failures()->whereNotNull('payment_id')->groupBy('payment_id')
            ->selectRaw('payment_id, COUNT(*) as failure_count')->pluck('failure_count', 'payment_id')->all();
    }

    public static function forChannel(int $id): array
    {
        if (!Schema::hasTable(self::TABLE)) return ['available' => false, 'events' => []];

        return [
            'available' => true,
            'events' => self::events(self::failures()->where('event.payment_id', $id)
                ->leftJoin('v2_order as orders', 'orders.id', '=', 'event.order_id')
                ->orderByDesc('event.created_at')->orderByDesc('event.id')->limit(20), [
                    'event.id', 'event.provider', 'event.stage', 'event.result', 'event.reason', 'event.request_id', 'event.created_at', 'orders.trade_no',
                    'event.gateway_host', 'event.gateway_http_status', 'event.gateway_code', 'event.gateway_order', 'event.gateway_actions', 'event.duration_ms',
                ], 'event'),
        ];
    }

    private static function events(\Illuminate\Database\Query\Builder $query, array $columns, ?string $alias = null): \Illuminate\Support\Collection
    {
        if (Schema::hasColumn(self::TABLE, 'gateway_response')) $columns[] = $alias ? $alias . '.gateway_response' : 'gateway_response';
        $query->select($columns);
        return PaymentGatewayTrace::selectAvailability($query, self::TABLE, $alias)->get()->each(function ($event) {
            $event->gateway_response = json_decode($event->gateway_response ?? 'null', true);
            $event->has_raw_diagnostic = (bool) $event->has_raw_diagnostic;
        });
    }

    private static function failures(): \Illuminate\Database\Query\Builder
    {
        return DB::table(self::TABLE . ' as event')->where('event.result', 'failed')
            ->where('event.created_at', '>=', time() - 3600);
    }
}
