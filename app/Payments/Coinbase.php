<?php

namespace App\Payments;

class Coinbase {
    protected array $config;
    public function __construct($config) {
        $this->config = $config;
    }

    public function form()
    {
        return [
            'coinbase_url' => [
                'label' => '接口地址',
                'description' => '',
                'type' => 'input',
            ],
            'coinbase_api_key' => [
                'label' => 'API KEY',
                'description' => '',
                'type' => 'input',
            ],
            'coinbase_webhook_key' => [
                'label' => 'WEBHOOK KEY',
                'description' => '',
                'type' => 'input',
            ],
        ];
    }

    public function pay($order) {

        $params = [
            'name' => '订阅套餐',
            'description' => '订单号 ' . $order['trade_no'],
            'pricing_type' => 'fixed_price',
            'local_price' => [
                'amount' => sprintf('%.2f', $order['total_amount'] / 100),
                'currency' => $order['currency'] ?? 'CNY'
            ],
            'metadata' => [
                "outTradeNo" => $order['trade_no'],
            ],
        ];

        $params_string = http_build_query($params);
        
        $ret_raw = self::_curlPost($this->config['coinbase_url'], $params_string);

        $ret = @json_decode($ret_raw, true);
        
        if(empty($ret['data']['hosted_url'])) {
            abort(500, "error!");
        }
        return [
            'type' => 1,
            'data' => $ret['data']['hosted_url'],
        ];
    }

    public function notify($params) {
        $payload = request()->getContent();
        $secret = (string)($this->config['coinbase_webhook_key'] ?? '');
        abort_if($secret === '' || $payload === '' || !hash_equals(hash_hmac('sha256', $payload, $secret),
            (string)request()->header('X-CC-Webhook-Signature')), 400, 'HMAC signature does not match');
        $body = json_decode($payload, true);
        $event = $body['event'] ?? null;
        abort_unless(is_array($event) && is_string($event['type'] ?? null), 400, 'Invalid payment event');
        if ($event['type'] !== 'charge:confirmed') return 'success';
        $trade = $event['data']['metadata']['outTradeNo'] ?? null;
        $id = $event['id'] ?? null;
        $price = $event['data']['pricing']['local'] ?? [];
        abort_unless(is_string($trade) && $trade !== '' && is_string($id) && $id !== '', 400, 'Invalid payment identity');
        $currency = $price['currency'] ?? null;
        abort_unless(is_string($currency) && in_array(strtoupper($currency), ['CNY','USD'], true), 400, 'Invalid payment currency');
        return ['trade_no'=>$trade, 'callback_no'=>$id,
            'amount'=>\App\Services\Money::parseMinor($price['amount'] ?? null), 'currency'=>strtoupper($currency)];
    }

    private function _curlPost($url,$params=false){
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_HEADER, 0);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 300);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $params);
        curl_setopt(
            $ch, CURLOPT_HTTPHEADER, array('X-CC-Api-Key:' .$this->config['coinbase_api_key'], 'X-CC-Version: 2018-03-22')
        );
        $result = curl_exec($ch);
        curl_close($ch);
        return $result;
    }


}
