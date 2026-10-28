<?php

namespace App\Payments;

use Omnipay\Omnipay;
use Omnipay\WechatPay\Helper;

class WechatPayNative {
    private array $config;

    public function __construct($config)
    {
        $this->config = $config;
    }

    public function form()
    {
        return [
            'app_id' => [
                'label' => 'APPID',
                'description' => '绑定微信支付商户的APPID',
                'type' => 'input',
            ],
            'mch_id' => [
                'label' => '商户号',
                'description' => '微信支付商户号',
                'type' => 'input',
            ],
            'api_key' => [
                'label' => 'APIKEY(v1)',
                'description' => '',
                'type' => 'input',
            ]
        ];
    }

    public function pay($order)
    {
        $gateway = Omnipay::create('WechatPay_Native');
        $gateway->setAppId($this->config['app_id']);
        $gateway->setMchId($this->config['mch_id']);
        $gateway->setApiKey($this->config['api_key']);
        $gateway->setNotifyUrl($order['notify_url']);

        $params = [
            'body'              => $order['trade_no'],
            'out_trade_no'      => $order['trade_no'],
            'total_fee'         => $order['total_amount'],
            'spbill_create_ip'  => '0.0.0.0',
            'fee_type'          => 'CNY'
        ];

        $request  = $gateway->purchase($params);
        $response = $request->send();
        $response = $response->getData();
        if ($response['return_code'] !== 'SUCCESS') {
            abort(500, $response['return_msg']);
        }
        return [
            'type' => 0,
            'data' => $response['code_url']
        ];
    }

    public function notify($params)
    {
        $data = Helper::xml2array(request()->getContent() ?: json_encode($_POST));
        $gateway = Omnipay::create('WechatPay');
        $gateway->setAppId($this->config['app_id']);
        $gateway->setMchId($this->config['mch_id']);
        $gateway->setApiKey($this->config['api_key']);
        $response = $gateway->completePurchase([
            'request_params' => request()->getContent() ?: json_encode($_POST)
        ])->send();

        if (!$response->isPaid() || ($data['appid'] ?? null) !== ($this->config['app_id'] ?? null) || ($data['mch_id'] ?? null) !== ($this->config['mch_id'] ?? null) || strtoupper((string)($data['fee_type'] ?? 'CNY')) !== 'CNY') {
            return('FAIL');
        }

        return [
            'trade_no' => $data['out_trade_no'],
            'callback_no' => $data['transaction_id'],
            'amount' => \App\Services\Money::parseMinorUnits($data['total_fee'] ?? null),
            'currency' => 'CNY',
            'custom_result' => '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>'
        ];
    }
}
