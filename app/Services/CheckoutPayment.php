<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CheckoutPayment
{
    // Persist before contacting a provider so retries cannot race an active checkout.
    public static function once(Request $request, callable $pay)
    {
        $diagnostic = new PaymentAttemptHistory($request->attributes->get('requestId'));
        $result = 'failed';
        try {
            return self::attempt($request, $pay, $diagnostic, $result);
        } finally {
            $diagnostic->finish($result);
        }
    }

    private static function attempt(Request $request, callable $pay, PaymentAttemptHistory $diagnostic, string &$outcome)
    {
        $key = $request->input('payment_request_key');
        $method = (int)$request->input('method');
        $switchFrom = (int) $request->input('switch_from_payment_method');
        $fingerprint = hash('sha256',json_encode([$method,$request->input('expected_payment_amount'),$request->input('expected_payment_currency')],JSON_THROW_ON_ERROR));
        $previous = DB::transaction(function () use ($request,$key,$method,$switchFrom,$fingerprint,$diagnostic,&$outcome) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            $diagnostic->identify($order, $method);
            $snapshot = $order->payment_snapshot ?: [];
            if ($request->boolean('resume_payment')) {
                return ['result' => self::resumeAction($order, $snapshot, $method, $diagnostic, $outcome)];
            }
            if (isset($snapshot['payment_attempts'][$key])) {
                $attempt = $snapshot['payment_attempts'][$key];
                $diagnostic->checkpoint('request_key_conflict');
                abort_unless(hash_equals($attempt['fingerprint'],$fingerprint),409,__('Invalid parameter'));
                if (in_array($attempt['result']['type'] ?? null, [0, 1], true)) {
                    if ((int) $order->status !== 0) return ['result' => ['type' => 2, 'data' => true]];
                    $provider = Payment::whereKey($method)->value('payment');
                    if (self::isCallbackOnlyChannel($order, $snapshot, $method, $provider)) {
                        $diagnostic->checkpoint('channel_unavailable');
                        abort(409, __('Payment method is not available'));
                    }
                    if (($order->payment_id && (int) $order->payment_id !== $method)
                        || (array_key_exists('payment_action_key', $snapshot) && $snapshot['payment_action_key'] !== $key)) {
                        $diagnostic->checkpoint('quote_changed');
                        abort(409, __('Payment quote changed. Reload and confirm the payment amount.'));
                    }
                }
                return $attempt;
            }
            $diagnostic->checkpoint('order_closed');
            abort_unless((int)$order->status === 0,409,__('Order does not exist or has been paid'));
            $currentMethod = (int) $order->payment_id;
            if ($method > 0 && $currentMethod === $method) {
                return ['result' => self::resumeAction($order, $snapshot, $method, $diagnostic, $outcome, $request)];
            }

            $switching = $switchFrom > 0 && $method > 0 && $switchFrom === $currentMethod;
            foreach ($snapshot['payment_attempts'] ?? [] as $attempt) {
                $state = $attempt['state'] ?? '';
                if ($state !== 'started'
                    && !($state === 'returned' && (int) ($attempt['result']['type'] ?? -2) === 2)) continue;

                if ($switching && $state === 'started'
                    && (int) ($attempt['method'] ?? 0) !== $method
                    && (($attempt['provider_failed'] ?? false) || PaymentAttemptHistory::hasFailed($order, $attempt))) {
                    if ((int) $attempt['method'] === $switchFrom) $diagnostic->previous($attempt);
                    continue;
                }
                $outcome = 'blocked';
                $diagnostic->checkpoint('in_flight');
                $diagnostic->previous($attempt);
                abort(409, __('Payment is being confirmed. Please check the order status before trying again.'));
            }
            if (!$switching && ($currentMethod > 0 || $switchFrom > 0)) {
                $diagnostic->checkpoint('quote_changed');
                abort(409, __('Payment quote changed. Reload and confirm the payment amount.'));
            }
            $diagnostic->checkpoint('internal_error');
            $snapshot['payment_attempts'][$key] = ['fingerprint'=>$fingerprint,'method'=>$method,'state'=>'started',
                'request_id'=>$request->attributes->get('requestId')];
            $order->payment_snapshot = $snapshot; $order->save();
            return null;
        },3);
        if ($previous) {
            $outcome = 'replayed';
            return response($previous['result'] ?? ['type'=>2,'data'=>true]);
        }
        try {
            $result = $pay($diagnostic);
        } catch (\Throwable $failure) {
            // Validation failures before any provider attempt are safe to correct and retry.
            DB::transaction(function () use ($request,$key) {
                $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
                if ((int) $order->status !== 0) return;
                $snapshot = $order->payment_snapshot ?: [];
                if ($request->attributes->get('checkout.provider_started')) {
                    $snapshot['payment_attempts'][$key]['provider_failed'] = true;
                } else {
                    unset($snapshot['payment_attempts'][$key]);
                }
                $order->payment_snapshot = $snapshot;
                $order->save();
            },3);
            throw $failure;
        }
        $data = json_decode($result->getContent(), true);
        $diagnostic->checkpoint('internal_error');
        $closed = DB::transaction(function () use ($request,$key,$data) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            // A callback can settle the old channel while the new one is returning its link.
            if ((int) $order->status !== 0 && in_array($data['type'] ?? null, [0, 1], true)) return true;
            $snapshot=$order->payment_snapshot ?: [];
            $snapshot['payment_attempts'][$key]['state']='returned';
            $snapshot['payment_attempts'][$key]['result']=$data;
            $snapshot['payment_action_key'] = in_array($data['type'] ?? null, [0, 1], true) ? $key : null;
            $order->payment_snapshot=$snapshot; $order->save();
            return false;
        },3);
        $outcome = match ($data['type'] ?? null) {
            -1 => 'settled',
            0 => 'qr_ready',
            1 => 'redirect_ready',
            2 => 'pending',
            default => 'action_ready',
        };
        return $closed ? response(['type' => 2, 'data' => true]) : $result;
    }

    private static function resumeAction(
        Order $order,
        array $snapshot,
        int $method,
        PaymentAttemptHistory $diagnostic,
        string &$outcome,
        ?Request $checkout = null,
    ): array
    {
        if ((int) $order->status !== 0) return ['type' => 2, 'data' => true];
        $diagnostic->checkpoint('channel_unavailable');
        abort_unless($method > 0 && (int) $order->payment_id === $method, 409, __('Payment method is not available'));
        $channel = Payment::whereKey($method)->where('enable', 1)->first(['uuid', 'payment']);
        $savedChannel = $snapshot['channels'][$method] ?? null;
        if (!isset($snapshot['channels']) && isset($snapshot['uuid'], $snapshot['provider'])) {
            $savedChannel = $snapshot;
        }
        abort_unless($channel && !self::isCallbackOnlyChannel($order, $snapshot, $method, $channel->payment)
            && (!isset($snapshot['channels']) || $savedChannel)
            && (!$savedChannel || (($savedChannel['uuid'] ?? null) === $channel->uuid
            && ($savedChannel['provider'] ?? null) === $channel->payment)), 409, __('Payment method is not available'));

        $attempts = $snapshot['payment_attempts'] ?? [];
        foreach ($attempts as $attempt) {
            if ((int) ($attempt['result']['type'] ?? -2) === 2
                || (($attempt['state'] ?? '') === 'started'
                && ((int) ($attempt['method'] ?? 0) === $method
                    || (!($attempt['provider_failed'] ?? false) && !PaymentAttemptHistory::hasFailed($order, $attempt))))) {
                $outcome = 'blocked';
                $diagnostic->checkpoint('in_flight');
                $diagnostic->previous($attempt);
                abort(409, __('Payment is being confirmed. Please check the order status before trying again.'));
            }
        }
        $candidates = $attempts;
        if (array_key_exists('payment_action_key', $snapshot)) {
            $key = $snapshot['payment_action_key'];
            $candidates = is_string($key) && isset($attempts[$key]) ? [$attempts[$key]] : [];
        }
        $actions = array_filter($candidates, static fn (array $attempt) =>
            (int) ($attempt['method'] ?? 0) === $method
            && ($attempt['state'] ?? '') === 'returned'
            && in_array($attempt['result']['type'] ?? null, [0, 1], true)
            && is_string($attempt['result']['data'] ?? null)
            && $attempt['result']['data'] !== '');
        $diagnostic->checkpoint('missing_payment_action');
        abort_unless(count($actions) === 1, 409, '当前订单没有可恢复的支付入口，请检查订单状态或切换支付方式。');

        $orderCurrency = $order->currency ?: 'CNY';
        $currency = $savedChannel['payment_currency'] ?? $orderCurrency;
        if ($checkout && ($checkout->filled('expected_payment_amount') || $checkout->filled('expected_payment_currency') || $currency !== $orderCurrency)) {
            // Reuse the issued quote. Legacy orders were charged their total plus the saved fee.
            $amount = $savedChannel['payment_amount']
                ?? ((int) $order->total_amount + (int) ($savedChannel['handling_amount'] ?? $order->handling_amount));
            $diagnostic->checkpoint('quote_changed');
            abort_unless((int) $checkout->input('expected_payment_amount') === $amount
                && $checkout->input('expected_payment_currency') === $currency, 409,
                __('Payment quote changed. Reload and confirm the payment amount.'));
        }
        return reset($actions)['result'];
    }

    private static function isCallbackOnlyChannel(Order $order, array $snapshot, int $method, ?string $provider): bool
    {
        $saved = $snapshot['channels'][$method]['provider'] ?? null;
        if ($saved === null && (int) $order->payment_id === $method) $saved = $snapshot['provider'] ?? null;
        return PaymentService::isCallbackOnly($provider) || PaymentService::isCallbackOnly($saved);
    }
}
