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
echo "Payment presentation validation and repeated catalog projection passed\n";
