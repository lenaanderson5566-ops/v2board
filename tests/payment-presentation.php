<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
use App\Services\PaymentPresentation;
$config=['_console_checkout'=>['category'=>'crypto','asset'=>'USDT','network'=>'tron','networkName'=>'TRON (TRC20)','networkIcon'=>'']];
PaymentPresentation::validate($config);
if (PaymentPresentation::fields([])['category']!=='regular') throw new RuntimeException('Legacy compatibility');
if (PaymentPresentation::fields($config)['network_icon']!=='/payment-icons/crypto-trx.svg') throw new RuntimeException('Network icon');
foreach (['asset'=>'','network'=>'','networkName'=>'','networkIcon'=>'javascript:alert(1)','category'=>'invalid'] as $key=>$value) {
    $bad=$config; $bad['_console_checkout'][$key]=$value;
    try { PaymentPresentation::validate($bad); throw new RuntimeException('Invalid metadata accepted: '.$key); }
    catch (Illuminate\Validation\ValidationException $expected) {}
}
$config['_console_checkout']['networkIcon']='https://example.test/network.png';
PaymentPresentation::validate($config);
if (PaymentPresentation::fields($config)['network_icon']!==$config['_console_checkout']['networkIcon']) throw new RuntimeException('Custom icon');
$catalog=new ReflectionProperty(PaymentPresentation::class,'catalog');
$loaded=$catalog->getValue();
if (!$loaded) throw new RuntimeException('Payment catalog not cached');
for($i=0;$i<20;$i++) {
    if (PaymentPresentation::fields($config)['network_icon']!==$config['_console_checkout']['networkIcon']) throw new RuntimeException('Repeated projection changed');
}
if ($catalog->getValue()!==$loaded) throw new RuntimeException('Payment catalog cache changed');

// Return routing uses server-owned order context, never caller-provided return URLs.
require_once __DIR__.'/fixtures/V10TestPayment.php';
$returnService = new class extends \App\Services\PaymentService {
    public function __construct() {
        $this->method = 'V10TestPayment';
        $this->config = ['uuid'=>'return-route-fixture'];
        $this->payment = new \App\Payments\V10TestPayment([]);
    }
};
$returnConfiguration = ['v2board.app_url'=>config('v2board.app_url'), 'cors.allowed_origins'=>config('cors.allowed_origins')];
$returnRequest = $app->make('request');
$returnChecks = 0;
$returnAssert = \Tests\Support\Assertions::counter($returnChecks);
try {
    config(['v2board.app_url'=>'https://panel.example/app', 'cors.allowed_origins'=>['*','https://frontend.example']]);
    $trade = 'order_abc-123 +/&?=#中文';
    $baseOrder = ['trade_no'=>$trade, 'total_amount'=>100, 'user_id'=>1, 'stripe_token'=>null,
        'return_url'=>'https://evil.example/#/takeover', 'returnUrl'=>'https://evil.example/#/takeover'];
    foreach (['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price'] as $period) {
        foreach ([null,'https://evil.example','https://frontend.example'] as $origin) {
            $request = \Illuminate\Http\Request::create('https://evil.example/api/v10/me/orders/payments','POST',[],[],[],[
                'HTTP_ORIGIN'=>$origin,'HTTP_X_FORWARDED_HOST'=>'evil.example','HTTP_X_ORIGINAL_HOST'=>'evil.example','HTTP_X_FORWARDED_PROTO'=>'http']);
            $app->instance('request',$request);
            $returnService->pay($baseOrder+['plan_id'=>42,'period'=>$period,'credit_bytes'=>0]);
            $sent = \App\Payments\V10TestPayment::$lastOrder;
            $expectedBase = $origin === 'https://frontend.example' ? $origin : 'https://panel.example/app';
            $returnAssert($sent['return_url']===$expectedBase.'/#/plan/42?order='.rawurlencode($trade),'Subscription returns in place with encoded order reference and a trusted origin');
            $returnAssert($sent['notify_url']==='https://panel.example/app/api/v10/webhooks/payments/V10TestPayment/return-route-fixture','Subscription return routing preserves callback construction');
            $returnAssert(!array_intersect(['plan_id','period','credit_bytes'],array_keys($sent)),'Internal routing context is not forwarded to payment SDKs');
        }
    }
    $app->instance('request',\Illuminate\Http\Request::create('https://panel.example/api/v10/me/orders/payments','POST'));
    foreach ([
        [],
        ['plan_id'=>42],
        ['plan_id'=>42,'period'=>'month_price'],
        ['plan_id'=>0,'period'=>'deposit','credit_bytes'=>0],
        ['plan_id'=>42,'period'=>'reset_price','credit_bytes'=>0],
        ['plan_id'=>42,'period'=>'onetime_price','credit_bytes'=>0],
        ['plan_id'=>42,'period'=>'month_price','credit_bytes'=>1024],
        ['plan_id'=>42,'period'=>'unknown','credit_bytes'=>0],
        ['plan_id'=>-1,'period'=>'month_price','credit_bytes'=>0],
    ] as $context) {
        $returnService->pay($baseOrder+$context);
        $returnAssert(\App\Payments\V10TestPayment::$lastOrder['return_url']==='https://panel.example/app/#/order/'.rawurlencode($trade),'Deposits, resets, credits and unknown context retain the encoded order route');
    }
} finally {
    config($returnConfiguration);
    $app->instance('request',$returnRequest);
}

echo "Payment presentation validation, catalog projection and {$returnChecks} return routing checks passed\n";
