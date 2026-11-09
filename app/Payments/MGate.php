<?php

namespace App\Payments;

use App\Services\PaymentAttemptHistory;
use App\Services\PaymentGatewayTransport;
use Curl\Curl;

class MGate
{
    private $config;

    public function __construct($config)
    {
        $this->config = $config;
    }

    public function form()
    {
        return [
            'mgate_url' => ['label' => 'API地址', 'description' => '填写网关基础地址，不包含 /v1/gateway/fetch', 'type' => 'input', 'required' => true],
            'mgate_app_id' => ['label' => 'APPID', 'description' => '', 'type' => 'input', 'required' => true],
            'mgate_app_secret' => ['label' => 'AppSecret', 'description' => '', 'type' => 'input', 'required' => true],
            'mgate_source_currency' => ['label' => '源货币', 'description' => '留空时按 CNY 校验订单，不发送源货币字段', 'type' => 'input'],
        ];
    }

    protected function createCurl()
    {
        return new Curl();
    }

    private function signature(array $params)
    {
        ksort($params);
        return md5(http_build_query($params) . $this->config['mgate_app_secret']);
    }

    public function validateConfig(string $currency, ?PaymentAttemptHistory $diagnostic = null): void
    {
        $url = rtrim(trim((string) ($this->config['mgate_url'] ?? '')), '/');
        $diagnostic?->checkpoint('invalid_config');
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(strtolower(parse_url($url, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true)) {
            abort(500, 'MGate：API地址格式有误');
        }
        $diagnostic?->checkpoint('missing_credentials');
        if (empty($this->config['mgate_app_id']) || empty($this->config['mgate_app_secret'])) {
            abort(500, 'MGate：请填写APPID和AppSecret');
        }
        $diagnostic?->checkpoint('currency_mismatch');
        abort_unless(strtoupper($this->sourceCurrency() ?? 'CNY') === strtoupper($currency), 422, 'MGate currency does not match the saved quote');
    }

    private function sourceCurrency(): ?string
    {
        $currency = trim((string) ($this->config['mgate_source_currency'] ?? ''));
        return $currency === '' ? null : $currency;
    }

    public function pay($order, ?PaymentAttemptHistory $diagnostic = null)
    {
        $this->validateConfig($order['currency'] ?? 'CNY', $diagnostic);
        $endpoint = rtrim(trim($this->config['mgate_url']), '/') . '/v1/gateway/fetch';
        $params = [
            'out_trade_no' => $order['trade_no'],
            'total_amount' => $order['total_amount'],
            'notify_url' => $order['notify_url'],
            'return_url' => $order['return_url'],
            'app_id' => $this->config['mgate_app_id'],
        ];
        $currency = $this->sourceCurrency();
        if ($currency !== null) {
            $params['source_currency'] = $currency;
        }
        ksort($params);
        $params['sign'] = $this->signature($params);
        $curl = $this->createCurl();
        try {
            $curl->setUserAgent('MGate');
            $curl->setOpt(CURLOPT_SSL_VERIFYPEER, true);
            $curl->setOpt(CURLOPT_SSL_VERIFYHOST, 2);
            $curl->setOpt(CURLOPT_CONNECTTIMEOUT, 10);
            $curl->setOpt(CURLOPT_TIMEOUT, 30);
            $diagnostic?->sending($endpoint);
            PaymentGatewayTransport::post($curl, $endpoint, http_build_query($params));
            $result = $curl->response;
            $diagnostic?->received($curl, $result->code ?? null, $result->data->trade_no ?? null, $result->data ?? null);
            if (!$result) abort(500, 'MGate：网络异常');
            if ($curl->error) {
                abort(500, 'MGate：接口请求失败');
            }
            $payUrl = $result->data->pay_url ?? null;
            if (empty($result->data->trade_no) || !is_string($payUrl) || !filter_var($payUrl, FILTER_VALIDATE_URL) || !in_array(strtolower(parse_url($payUrl, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true)) {
                if (!isset($result->data) && is_string($result->msg ?? null) && trim($result->msg) !== '') {
                    $diagnostic?->checkpoint('gateway_rejected');
                    abort(500, 'MGate：网关未返回支付入口，请在支付诊断中查看网关提示');
                }
                if (is_object($result)) $diagnostic?->checkpoint('missing_payment_action');
                abort(500, 'MGate：接口返回数据不完整');
            }
            return ['type' => 1, 'data' => $payUrl];
        } finally {
            $curl->close();
        }
    }

    public function notify($params)
    {
        if (!is_array($params) || empty($this->config['mgate_app_secret'])) return false;
        foreach ($params as $value) {
            if (!is_scalar($value)) return false;
        }
        $sign = $params['sign'] ?? null;
        if (!is_string($sign) || !preg_match('/^[a-f0-9]{32}$/i', $sign) || empty($params['out_trade_no']) || empty($params['trade_no'])) return false;
        unset($params['sign']);
        if (!hash_equals($this->signature($params), strtolower($sign))) return false;
        if (!isset($params['app_id']) || (string)$params['app_id'] !== (string)($this->config['mgate_app_id'] ?? '')) return false;
        try { $amount = \App\Services\Money::parseMinorUnits($params['total_amount'] ?? null); }
        catch (\InvalidArgumentException $e) { return false; }
        $currency = strtoupper((string)($params['source_currency'] ?? 'CNY'));
        if ($currency !== 'CNY' || $currency !== strtoupper($this->sourceCurrency() ?? 'CNY')) return false;
        return ['trade_no'=>$params['out_trade_no'], 'callback_no'=>$params['trade_no'], 'amount'=>$amount, 'currency'=>$currency];
    }
}
