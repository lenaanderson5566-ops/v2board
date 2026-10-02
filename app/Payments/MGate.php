<?php

namespace App\Payments;

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
            'mgate_source_currency' => ['label' => '源货币', 'description' => '默认CNY', 'type' => 'input', 'value' => 'CNY'],
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

    public function pay($order)
    {
        $url = rtrim(trim((string) ($this->config['mgate_url'] ?? '')), '/');
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(strtolower(parse_url($url, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true)) {
            abort(500, 'MGate：API地址格式有误');
        }
        if (empty($this->config['mgate_app_id']) || empty($this->config['mgate_app_secret'])) {
            abort(500, 'MGate：请填写APPID和AppSecret');
        }
        // Preserve the supplied adapter protocol: amounts are passed through in cents.
        $params = [
            'out_trade_no' => $order['trade_no'],
            'total_amount' => $order['total_amount'],
            'notify_url' => $order['notify_url'],
            'return_url' => $order['return_url'],
            'source_currency' => trim((string) ($this->config['mgate_source_currency'] ?? '')) ?: 'CNY',
            'app_id' => $this->config['mgate_app_id'],
        ];
        ksort($params);
        $params['sign'] = $this->signature($params);
        $curl = $this->createCurl();
        try {
            $curl->setUserAgent('MGate');
            $curl->setOpt(CURLOPT_SSL_VERIFYPEER, true);
            $curl->setOpt(CURLOPT_SSL_VERIFYHOST, 2);
            $curl->setOpt(CURLOPT_CONNECTTIMEOUT, 10);
            $curl->setOpt(CURLOPT_TIMEOUT, 30);
            $curl->post($url . '/v1/gateway/fetch', http_build_query($params));
            $result = $curl->response;
            if (!$result) abort(500, 'MGate：网络异常');
            if ($curl->error) {
                $message = is_object($result) && isset($result->message) && is_string($result->message) ? $result->message : '接口请求失败';
                if (isset($result->errors)) {
                    foreach ((array) $result->errors as $errors) {
                        if (is_array($errors) && isset($errors[0]) && is_string($errors[0])) { $message = $errors[0]; break; }
                    }
                }
                abort(500, 'MGate：' . $message);
            }
            $payUrl = $result->data->pay_url ?? null;
            if (empty($result->data->trade_no) || !is_string($payUrl) || !filter_var($payUrl, FILTER_VALIDATE_URL) || !in_array(strtolower(parse_url($payUrl, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true)) {
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
        if (isset($params['app_id']) && (string) $params['app_id'] !== (string) ($this->config['mgate_app_id'] ?? '')) return false;
        return ['trade_no' => $params['out_trade_no'], 'callback_no' => $params['trade_no']];
    }
}
