<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
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
echo "Payment presentation validation passed\n";
