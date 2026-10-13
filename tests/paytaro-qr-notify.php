<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(function (Throwable $e) { fwrite(STDERR, $e->getMessage()."\n"); exit(1); });
$checks = 0;
$assert = function ($ok, $message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$gateway = new App\Payments\PaytaroQR(['pid'=>'local-app', 'key'=>'local-secret']);
$body = ['app_id'=>'local-app', 'merchant_no'=>'local-order', 'callback_no'=>'local-callback', 'status'=>'PAID', 'order_amount'=>328, 'order_currency'=>'CNY'];
$originalHeader = $_SERVER['HTTP_X_APP_SECRET'] ?? null;
$call = function ($header, $payload) use ($app, $gateway) {
    $request = Illuminate\Http\Request::create('/local-test', 'POST', [], [], [], ['CONTENT_TYPE'=>'application/json'], json_encode($payload));
    if ($header !== null) $request->headers->set('X-App-Secret', $header);
    $app->instance('request', $request);
    return $gateway->notify($request->input());
};
try {
    unset($_SERVER['HTTP_X_APP_SECRET']);
    $verified = $call('local-secret', $body);
    $assert(is_array($verified) && $verified['trade_no']==='local-order' && $verified['callback_no']==='local-callback', 'Laravel JSON request header must verify without PHP globals');
    $assert($call(null, $body)===false, 'Missing secret must fail');
    $assert($call('wrong-secret', $body)===false, 'Incorrect secret must fail');
    $assert($call('local-secret', array_replace($body, ['status'=>'PENDING']))===false, 'Unpaid event must fail');
    $assert($call('local-secret', array_replace($body, ['merchant_no'=>'']))===false, 'Missing order must fail');
    $_SERVER['HTTP_X_APP_SECRET']='local-secret';
    $assert($call('wrong-secret', $body)===false, 'Request header must take precedence over a stale global');
    unset($_SERVER['HTTP_X_APP_SECRET']);
    $assert($verified['amount'] === 32800 && $verified['currency'] === 'CNY', 'Original order amount converts yuan to integer fen');
    foreach ([328, '328.00', 328.0] as $amount) {
        $r = $call('local-secret', array_replace($body, ['order_amount'=>$amount, 'pay_amount'=>45.5, 'pay_currency'=>'USDT']));
        $assert($r['amount'] === 32800 && $r['currency'] === 'CNY', 'Settlement uses original order currency, not paid token amount');
    }
    $r = $call('local-secret', array_replace($body, ['order_amount'=>'0.29', 'status'=>'SUCCESS']));
    $assert($r['amount'] === 29, 'Decimal precision and manual retry status supported');
    foreach ([null, -1, 0, '328.001', '1e2', [], true, 'NaN', '99999999999999'] as $amount) {
        $assert($call('local-secret', array_replace($body, ['order_amount'=>$amount])) === false, 'Invalid or absent amounts fail closed');
    }
    foreach ([null, '', [], 'CNY ' ] as $currency) {
        $assert($call('local-secret', array_replace($body, ['order_currency'=>$currency])) === false, 'Invalid or absent currency fails closed');
    }
    echo "PaytaroQR notify: {$checks} checks passed\n";
} finally {
    if ($originalHeader === null) unset($_SERVER['HTTP_X_APP_SECRET']);
    else $_SERVER['HTTP_X_APP_SECRET']=$originalHeader;
}
