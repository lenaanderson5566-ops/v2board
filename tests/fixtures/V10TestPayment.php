<?php
namespace App\Payments;

/** Local test provider: no network requests or real payments. */
class V10TestPayment
{
    public static $lastOrder;
    public function __construct(array $config) {}
    public function notify(array $params)
    {
        if (($params['signature'] ?? '') !== 'local-test-signature') return false;
        return ['trade_no'=>$params['orderNumber'], 'callback_no'=>'local-callback', 'custom_result'=>'success'];
    }
    public function pay(array $order) { self::$lastOrder=$order; return ['type'=>1, 'data'=>$order['notify_url']]; }
}
