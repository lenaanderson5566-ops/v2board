<?php
namespace App\Services;

use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CheckoutPayment
{
    // Persist before contacting a provider: uncertain retries resume status checks, not a second charge.
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
        $fingerprint = hash('sha256',json_encode([$method,$request->input('expected_payment_amount'),$request->input('expected_payment_currency')],JSON_THROW_ON_ERROR));
        $previous = DB::transaction(function () use ($request,$key,$method,$fingerprint,$diagnostic,&$outcome) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            $diagnostic->identify($order, $method);
            $snapshot = $order->payment_snapshot ?: [];
            if (isset($snapshot['payment_attempts'][$key])) {
                $attempt = $snapshot['payment_attempts'][$key];
                $diagnostic->checkpoint('request_key_conflict');
                abort_unless(hash_equals($attempt['fingerprint'],$fingerprint),409,__('Invalid parameter'));
                return $attempt;
            }
            $diagnostic->checkpoint('order_closed');
            abort_unless((int)$order->status === 0,409,__('Order does not exist or has been paid'));
            // A different key cannot bypass an in-flight call.
            foreach ($snapshot['payment_attempts'] ?? [] as $attempt) {
                if (($attempt['state'] ?? '') === 'started'
                    || (($attempt['state'] ?? '') === 'returned' && (int)($attempt['result']['type'] ?? -2) === 2)) {
                    $outcome = 'blocked';
                    $diagnostic->checkpoint('in_flight');
                    $diagnostic->previous($attempt);
                    abort(409, __('Payment is being confirmed. Please check the order status before trying again.'));
                }
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
                if (!$request->attributes->get('checkout.provider_started') && (int)$order->status === 0) {
                    $snapshot=$order->payment_snapshot ?: []; unset($snapshot['payment_attempts'][$key]);
                    $order->payment_snapshot=$snapshot; $order->save();
                }
            },3);
            throw $failure;
        }
        $data = json_decode($result->getContent(), true);
        $diagnostic->checkpoint('internal_error');
        DB::transaction(function () use ($request,$key,$data) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            $snapshot=$order->payment_snapshot ?: [];
            $snapshot['payment_attempts'][$key]['state']='returned';
            $snapshot['payment_attempts'][$key]['result']=$data;
            $order->payment_snapshot=$snapshot; $order->save();
        },3);
        $outcome = match ($data['type'] ?? null) {
            -1 => 'settled',
            0 => 'qr_ready',
            1 => 'redirect_ready',
            2 => 'pending',
            default => 'action_ready',
        };
        return $result;
    }
}
