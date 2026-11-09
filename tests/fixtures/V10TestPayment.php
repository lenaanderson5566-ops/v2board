<?php
namespace App\Payments;

/** Local test provider: no network requests or real payments. */
class V10TestPayment
{
    public static $lastOrder;
    public static ?\Closure $payHandler = null;
    public function __construct(array $config) {}
    public function notify(array $params)
    {
        if (($params['signature'] ?? '') !== 'local-test-signature') return false;
        return ['trade_no'=>$params['orderNumber'], 'callback_no'=>'local-callback', 'amount'=>\App\Services\Money::parseMinorUnits($params['amount'] ?? null), 'currency'=>$params['currency'] ?? '', 'custom_result'=>'success'];
    }
    public function pay(array $order, ?\App\Services\PaymentAttemptHistory $diagnostic = null)
    {
        self::$lastOrder = $order;
        return self::$payHandler ? (self::$payHandler)($order, $diagnostic) : ['type' => 1, 'data' => $order['notify_url']];
    }
}
