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
        $key = $request->input('payment_request_key');
        $method = (int)$request->input('method');
        $fingerprint = hash('sha256',json_encode([$method,$request->input('expected_payment_amount'),$request->input('expected_payment_currency')],JSON_THROW_ON_ERROR));
        $previous = DB::transaction(function () use ($request,$key,$method,$fingerprint) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            $snapshot = $order->payment_snapshot ?: [];
            if (isset($snapshot['payment_attempts'][$key])) {
                $attempt = $snapshot['payment_attempts'][$key];
                abort_unless(hash_equals($attempt['fingerprint'],$fingerprint),409,__('Invalid parameter'));
                return $attempt;
            }
            abort_unless((int)$order->status === 0,409,__('Order does not exist or has been paid'));
            // A different key cannot bypass an in-flight call.
            foreach ($snapshot['payment_attempts'] ?? [] as $attempt) abort_if(($attempt['state'] ?? '') === 'started'
                || (($attempt['state'] ?? '') === 'returned' && (int)($attempt['result']['type'] ?? -2) === 2),409,
                __('Payment is being confirmed. Please check the order status before trying again.'));
            $snapshot['payment_attempts'][$key] = ['fingerprint'=>$fingerprint,'method'=>$method,'state'=>'started'];
            $order->payment_snapshot = $snapshot; $order->save();
            return null;
        },3);
        if ($previous) return response($previous['result'] ?? ['type'=>2,'data'=>true]);
        try {
            $result = $pay();
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
        DB::transaction(function () use ($request,$key,$result) {
            $order = Order::where('user_id',$request->user['id'])->where('trade_no',$request->input('trade_no'))->lockForUpdate()->firstOrFail();
            $snapshot=$order->payment_snapshot ?: [];
            $snapshot['payment_attempts'][$key]['state']='returned';
            $snapshot['payment_attempts'][$key]['result']=json_decode($result->getContent(),true);
            $order->payment_snapshot=$snapshot; $order->save();
        },3);
        return $result;
    }
}
