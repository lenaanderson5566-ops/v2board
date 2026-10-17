<?php

namespace App\Payments;


class BTCPay {
    protected array $config;
    public function __construct($config) {
        $this->config = $config;
    }

    public function form()
    {
        return [
            'btcpay_url' => [
                'label' => 'API接口所在网址(包含最后的斜杠)',
                'description' => '',
                'type' => 'input',
            ],
            'btcpay_storeId' => [
                'label' => 'storeId',
                'description' => '',
                'type' => 'input',
            ],
            'btcpay_api_key' => [
                'label' => 'API KEY',
                'description' => '个人设置中的API KEY(非商店设置中的)',
                'type' => 'input',
            ],
            'btcpay_webhook_key' => [
                'label' => 'WEBHOOK KEY',
                'description' => '',
                'type' => 'input',
            ],
        ];
    }

    public function pay($order) {

        $params = [
            'jsonResponse' => true,
            'amount' => sprintf('%.2f', $order['total_amount'] / 100),
            'currency' => $order['currency'] ?? 'CNY',
            'metadata' => [
                'orderId' => $order['trade_no']
            ]
        ];

        $params_string = @json_encode($params);

        $ret_raw = self::_curlPost($this->config['btcpay_url'] . 'api/v1/stores/' . $this->config['btcpay_storeId'] . '/invoices', $params_string);

        $ret = @json_decode($ret_raw, true);
        
        if(empty($ret['checkoutLink'])) {
            abort(500, "error!");
        }
        return [
            'type' => 1, // Redirect to url
            'data' => $ret['checkoutLink'],
        ];
    }

    public function notify($params) {
        $payload = request()->getContent();
        $secret = (string)($this->config['btcpay_webhook_key'] ?? '');
        abort_if($secret === '' || $payload === '' || !hash_equals('sha256='.hash_hmac('sha256', $payload, $secret),
            (string)request()->header('Btcpay-Sig')), 400, 'HMAC signature does not match');
        $body = json_decode($payload, true);
        $event = $body;
        abort_unless(is_array($event) && is_string($event['type'] ?? null), 400, 'Invalid payment event');
        if ($event['type'] !== 'InvoiceSettled') return 'success';
        $id = $event['invoiceId'] ?? null;
        abort_unless(is_string($id) && $id !== '' && strlen($id) <= 128, 400, 'Invalid invoice ID');
        $invoice = $this->fetchInvoice($id);
        abort_unless(($invoice['id'] ?? null) === $id && ($invoice['status'] ?? null) === 'Settled'
            && in_array($invoice['additionalStatus'] ?? null, ['None','PaidLate','PaidOver'], true), 400, 'Invoice is not settled');
        $trade = $invoice['metadata']['orderId'] ?? null;
        $price = $invoice;
        abort_unless(is_string($trade) && $trade !== '' && is_string($id) && $id !== '', 400, 'Invalid payment identity');
        $currency = $price['currency'] ?? null;
        abort_unless(is_string($currency) && in_array(strtoupper($currency), ['CNY','USD'], true), 400, 'Invalid payment currency');
        return ['trade_no'=>$trade, 'callback_no'=>$id,
            'amount'=>\App\Services\Money::parseMinor($price['amount'] ?? null), 'currency'=>strtoupper($currency)];
    }

    protected function fetchInvoice(string $id): array
    {
        // Do not forward store API credentials to redirect targets.
        $url = rtrim($this->config['btcpay_url'], '/') . '/api/v1/stores/'
            . rawurlencode($this->config['btcpay_storeId']) . '/invoices/' . rawurlencode($id);
        $response = (new \GuzzleHttp\Client())->get($url, ['headers'=>[
            'Authorization'=>'token '.$this->config['btcpay_api_key'], 'Accept'=>'application/json'],
            'connect_timeout'=>5, 'timeout'=>15, 'allow_redirects'=>false]);
        abort_unless($response->getStatusCode() === 200, 502, 'Invoice verification failed');
        $invoice = json_decode((string)$response->getBody(), true);
        abort_unless(is_array($invoice), 502, 'Invalid invoice response');
        return $invoice;
    }

    private function _curlPost($url,$params=false){
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_HEADER, 0);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 300);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
        curl_setopt(
            $ch, CURLOPT_HTTPHEADER, array('Authorization:' .'token '.$this->config['btcpay_api_key'], 'Content-Type: application/json')
        );
        $result = curl_exec($ch);
        curl_close($ch);
        return $result;
    }


}
