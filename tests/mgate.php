<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');

class MGateFakeCurl
{
    public $response;
    public $error = false;
    public $options = [];
    public $url;
    public $body;
    public $closed = false;
    public function setUserAgent($value) {}
    public function setOpt($key, $value) { $this->options[$key] = $value; }
    public function post($url, $body) { $this->url = $url; $this->body = $body; }
    public function close() { $this->closed = true; }
}
class MGateTestAdapter extends App\Payments\MGate
{
    public $curl;
    protected function createCurl() { return $this->curl; }
}
$checks = 0;
$assert = function ($condition, $message) use (&$checks) { if (!$condition) throw new RuntimeException($message); $checks++; };
$config = ['mgate_url' => 'https://gateway.example/', 'mgate_app_id' => 'app-test', 'mgate_app_secret' => 'test-only-secret', 'mgate_source_currency' => ''];
$adapter = new MGateTestAdapter($config);
$curl = new MGateFakeCurl();
$curl->response = (object) ['data' => (object) ['trade_no' => 'gateway-order', 'pay_url' => 'https://gateway.example/pay/test']];
$adapter->curl = $curl;
$result = $adapter->pay(['trade_no' => 'local-order', 'total_amount' => 1234, 'notify_url' => 'https://site.example/notify', 'return_url' => 'https://site.example/app#/order/local-order']);
$assert($result === ['type' => 1, 'data' => 'https://gateway.example/pay/test'], 'Payment URL contract failed');
$assert($curl->url === 'https://gateway.example/v1/gateway/fetch', 'Endpoint normalization failed');
parse_str($curl->body, $payload);
$sign = $payload['sign']; unset($payload['sign']); ksort($payload);
$assert($sign === md5(http_build_query($payload) . $config['mgate_app_secret']), 'Request signature failed');
$assert($payload['total_amount'] === '1234' && $payload['source_currency'] === 'CNY', 'Amount or default currency changed');
$assert($curl->options[CURLOPT_SSL_VERIFYPEER] === true && $curl->options[CURLOPT_SSL_VERIFYHOST] === 2 && $curl->closed, 'TLS verification or cleanup failed');
$signed = function ($params) use ($config) { ksort($params); $params['sign'] = md5(http_build_query($params) . $config['mgate_app_secret']); return $params; };
$params = $signed(['out_trade_no' => 'local-order', 'trade_no' => 'gateway-order', 'app_id' => 'app-test']);
$assert($adapter->notify($params) === ['trade_no' => 'local-order', 'callback_no' => 'gateway-order'], 'Valid callback rejected');
$params['out_trade_no'] = 'tampered';
$assert($adapter->notify($params) === false, 'Tampered callback accepted');
foreach ([[], ['sign' => []], $signed(['out_trade_no' => 'local-order']), $signed(['out_trade_no' => 'local-order', 'trade_no' => 'gateway-order', 'app_id' => 'other'])] as $invalid) {
    $assert($adapter->notify($invalid) === false, 'Malformed or wrong-app callback accepted');
}
$curl->closed = false;
$curl->response = (object) ['data' => (object) ['trade_no' => 'gateway-order', 'pay_url' => 'javascript:alert(1)']];
try { $adapter->pay(['trade_no'=>'local-order','total_amount'=>1234,'notify_url'=>'https://site.example/notify','return_url'=>'https://site.example/app']); throw new RuntimeException('Unsafe URL accepted'); }
catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode() === 500 && $curl->closed, 'Error handling failed'); }
$methods = json_decode((new App\Http\Controllers\V1\Admin\PaymentController())->getPaymentMethods()->getContent(), true)['data'];
$assert(in_array('MGate', $methods, true), 'Admin discovery failed');
$form = (new App\Services\PaymentService('MGate'))->form();
$assert(count($form) === 4 && $form['mgate_source_currency']['value'] === 'CNY', 'Admin form failed');
echo "MGate: {$checks} checks passed (no external payment requests)\n";
