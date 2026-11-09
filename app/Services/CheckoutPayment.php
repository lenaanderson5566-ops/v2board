<?php
namespace App\Services;

use App\Models\Order;
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
            if (isset($snapshot['payment_attempts'][$key])) {
                $attempt = $snapshot['payment_attempts'][$key];
                $diagnostic->checkpoint('request_key_conflict');
                abort_unless(hash_equals($attempt['fingerprint'],$fingerprint),409,__('Invalid parameter'));
                if (in_array($attempt['result']['type'] ?? null, [0, 1], true)) {
                    if ((int) $order->status !== 0) return ['result' => ['type' => 2, 'data' => true]];
                    if ($order->payment_id && (int) $order->payment_id !== $method) {
                        $diagnostic->checkpoint('quote_changed');
                        abort(409, __('Payment quote changed. Reload and confirm the payment amount.'));
                    }
                }
                return $attempt;
            }
            $diagnostic->checkpoint('order_closed');
            abort_unless((int)$order->status === 0,409,__('Order does not exist or has been paid'));
            $currentMethod = (int) $order->payment_id;
            $switching = $switchFrom > 0 && $method > 0 && $switchFrom !== $method;
            if ($switching && $currentMethod !== 0 && $currentMethod !== $switchFrom) {
                $diagnostic->checkpoint('quote_changed');
                abort(409, __('Payment quote changed. Reload and confirm the payment amount.'));
            }
            foreach ($snapshot['payment_attempts'] ?? [] as $attempt) {
                $state = $attempt['state'] ?? '';
                if ($state !== 'started'
                    && !($state === 'returned' && (int) ($attempt['result']['type'] ?? -2) === 2)) continue;

                if ($switching && $currentMethod === $switchFrom && $state === 'started'
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
}
