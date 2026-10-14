<?php
namespace App\Services;
use App\Models\Order;
use App\Models\Payment;

final class PaymentQuote
{
    public static function make(Order $order, Payment $payment): array
    {
        $existing=$order->payment_snapshot['channels'][(string)$payment->id] ?? null;
        if ($existing && isset($existing['payment_amount'])) return $existing;
        $from=$order->currency ?: 'CNY'; $to=$payment->currency ?: 'CNY';
        abort_unless(($from === 'CNY' && $to === 'CNY') || in_array($payment->payment,['EPay','Paytaro','PaytaroQR','StripeCheckout'],true),422,'Payment channel has no verified multicurrency settlement contract');
        abort_unless($to === 'CNY' || ($to === 'USD' && $payment->payment === 'StripeCheckout'),422,'Unsupported payment currency');
        $rate=$from === $to ? [] : ExchangeRate::snapshot();
        $base=ExchangeRate::convert((int)$order->total_amount,$from,$to,$rate);
        $paymentFee=(int)round($base*((float)$payment->handling_fee_percent/100))+(int)$payment->handling_fee_fixed;
        $amount=$base+$paymentFee;
        $fee=ExchangeRate::convert($paymentFee,$to,$from,$rate);
        abort_if($amount < 1,422,'Payment amount is too small after currency conversion');
        return ['handling_amount'=>$fee,'payment_amount'=>$amount,'payment_currency'=>$to,'payment_fee'=>$paymentFee,'fx'=>$rate];
    }
}
