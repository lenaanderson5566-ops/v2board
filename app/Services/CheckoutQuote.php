<?php
namespace App\Services;

use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;

final class CheckoutQuote
{
    private static function selection(Request $request): array
    {
        return ['userId'=>(int)$request->user['id'], 'planId'=>(int)$request->input('plan_id'),
            'period'=>$request->input('period'), 'couponId'=>(int)$request->input('wallet_coupon_id',0),
            'replacement'=>$request->input('replace_trade_no'), 'methodId'=>(int)$request->input('quote_method',0)];
    }

    private static function totals(Order $order, User $user, int $methodId): array
    {
        $balance = min(max(0,(int)$user->balance),max(0,(int)$order->total_amount));
        $amount = (int)$order->total_amount - $balance;
        $payment = null; $channel = [];
        if ($amount > 0 && $methodId > 0) {
            $payment = Payment::find($methodId);
            abort_unless($payment && (int)$payment->enable === 1 && !in_array($payment->payment,PaymentService::RETIRED_METHODS,true),409,__('Payment method is not available'));
            $draft = clone $order; $draft->total_amount = $amount;
            $channel = PaymentQuote::make($draft,$payment);
        }
        return [[
            'plan_amount'=>(int)$order->total_amount+(int)$order->discount_amount+(int)$order->surplus_amount-(int)$order->refund_amount,
            'currency'=>$order->currency, 'discount_amount'=>(int)$order->discount_amount,
            'surplus_amount'=>(int)$order->surplus_amount, 'refund_amount'=>(int)$order->refund_amount,
            'balance_amount'=>$balance, 'total_amount'=>$amount,
            'handling_amount'=>(int)($channel['handling_amount'] ?? 0),
            'payment_amount'=>(int)($channel['payment_amount'] ?? $amount),
            'payment_currency'=>$channel['payment_currency'] ?? $order->currency,
            'payment_method_id'=>$amount > 0 ? $methodId : 0,
        ], $payment, $channel];
    }

    public static function preview(Request $request, Order $order, User $user): array
    {
        [$totals,$payment] = self::totals($order,$user,(int)$request->input('quote_method',0));
        $draft = clone $order; $draft->total_amount = $totals['total_amount'];
        $methods = $draft->total_amount > 0 ? json_decode(app(Actions\User\OrderActions::class)->getPaymentMethod($request,$draft)->getContent(),true)['data'] : [];
        $expires = time()+300;
        $token = ($totals['total_amount'] === 0 || $totals['payment_method_id'] > 0)
            ? Crypt::encryptString(json_encode(['selection'=>self::selection($request),'totals'=>$totals,'channel'=>self::channelIdentity($payment),'expires'=>$expires],JSON_THROW_ON_ERROR)) : null;
        return $totals + ['quote_token'=>$token,'expires_at'=>$expires,'methods'=>$methods];
    }

    private static function channelIdentity(?Payment $payment): ?array
    {
        return $payment ? ['uuid'=>$payment->uuid,'provider'=>$payment->payment,'name'=>$payment->name,
            'presentation'=>PaymentPresentation::fields($payment->config ?? [])] : null;
    }

    private static function decode(Request $request): array
    {
        try { $data = json_decode(Crypt::decryptString($request->input('checkout_quote')),true,512,JSON_THROW_ON_ERROR); }
        catch (\Throwable $e) { abort(409,__('Payment quote changed. Reload and confirm the payment amount.')); }
        abort_unless(isset($data['selection'],$data['totals'],$data['expires']) && $data['selection'] === self::selection($request),409,
            __('Payment quote changed. Reload and confirm the payment amount.'));
        return $data;
    }

    public static function replay(Request $request): ?Order
    {
        self::decode($request);
        abort_unless($request->filled('checkout_request_key'),422,__('Invalid parameter'));
        $order = Order::where('user_id',$request->user['id'])
            ->where('payment_snapshot->checkout_request->requestKey',$request->input('checkout_request_key'))->first();
        if ($order) abort_unless(hash_equals($order->payment_snapshot['checkout_request']['fingerprint'],hash('sha256',$request->input('checkout_quote'))),409,
            __('Payment quote changed. Reload and confirm the payment amount.'));
        return $order;
    }

    public static function confirm(Request $request, Order $order, User $user): void
    {
        $data = self::decode($request);
        [$totals,$payment,$channel] = self::totals($order,$user,(int)$request->input('quote_method',0));
        abort_unless($data['expires'] > time() && $data['totals'] === $totals && ($data['channel'] ?? null) === self::channelIdentity($payment),409,
            __('Payment quote changed. Reload and confirm the payment amount.'));
        $snapshot = ['checkout_request'=>['requestKey'=>$request->input('checkout_request_key'),
            'fingerprint'=>hash('sha256',$request->input('checkout_quote'))]];
        if ($payment) $snapshot['channels'][(string)$payment->id] = OrderPaymentHistory::capture($payment) + $channel + ['uuid'=>$payment->uuid];
        $order->payment_snapshot = $snapshot;
    }
}
