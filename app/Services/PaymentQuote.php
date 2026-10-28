<?php
namespace App\Services;
use App\Models\Order;
use App\Models\Payment;

final class PaymentQuote
{
    public const LEGACY_STRIPE = ['StripeCredit','StripeAlipay','StripeWepay','StripeALL'];
    public static function make(Order $order, Payment $payment): array
    {
        $existing=$order->payment_snapshot['channels'][(string)$payment->id] ?? null;
        if ($existing && isset($existing['payment_amount'])) return $existing;
        $from=$order->currency ?: 'CNY'; $feeCurrency=$payment->currency ?: 'CNY';
        $legacyStripe=in_array($payment->payment,self::LEGACY_STRIPE,true);
        $to=$legacyStripe ? strtoupper((string)($payment->config['currency'] ?? 'CNY')) : $feeCurrency;
        abort_unless(($from === 'CNY' && $to === 'CNY') || in_array($payment->payment,array_merge(['EPay','Paytaro','PaytaroQR','StripeCheckout'],self::LEGACY_STRIPE),true),422,'Payment channel has no verified multicurrency settlement contract');
        abort_unless($to === 'CNY' || ($to === 'USD' && ($payment->payment === 'StripeCheckout' || $legacyStripe)),422,'Unsupported payment currency');
        $rate=$from === $to && $from === $feeCurrency ? [] : ExchangeRate::snapshot();
        $base=ExchangeRate::convert((int)$order->total_amount,$from,$feeCurrency,$rate);
        $paymentFee=(int)round($base*((float)$payment->handling_fee_percent/100))+(int)$payment->handling_fee_fixed;
        $amount=ExchangeRate::convert($base+$paymentFee,$feeCurrency,$to,$rate);
        $fee=ExchangeRate::convert($paymentFee,$feeCurrency,$from,$rate);
        abort_if($amount < 1,422,'Payment amount is too small after currency conversion');
        return ['handling_amount'=>$fee,'payment_amount'=>$amount,'payment_currency'=>$to,'payment_fee'=>$paymentFee,'fx'=>$rate];
    }
}
