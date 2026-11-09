<?php

namespace App\Services;

final class PaymentGatewayResponse
{
    private const CONTAINERS = ['data', 'result', 'payload', 'error'];
    private const CODES = ['code', 'error_code', 'errorCode', 'status'];
    private const MESSAGES = ['msg', 'message', 'error_message', 'errorMessage', 'error', 'errors'];
    private const ACTIONS = ['pay_url', 'payurl', 'payUrl', 'payment_url', 'paymentUrl', 'checkout_url', 'checkoutUrl', 'qrcode', 'qr_code', 'qrCode', 'urlscheme', 'urlScheme', 'url', 'link', 'redirect_url', 'redirectUrl'];
    private const ORDERS = ['trade_no', 'tradeNo', 'out_trade_no', 'outTradeNo', 'order_id', 'orderId', 'order_no', 'orderNo'];
    private const SENSITIVE = ['sign', 'signature', 'pid', 'key', 'app_id', 'appId', 'app_secret', 'appSecret', 'token', 'access_token', 'api_key', 'secret'];
    private const OTHER = ['success', 'pay_type', 'pay_data', 'type', 'money', 'amount', 'currency', 'sign_type'];
    // Match provider wording, but persist only these fixed labels. Providers can echo arbitrary request data in messages.
    private const SAFE_MESSAGES = [
        '/stats pid is null|pid (?:is )?(?:required|missing|null|empty)|(?:缺少|未传|未填写)\s*pid/iu' => '商户 PID 缺失',
        '/invalid (?:pid|app[_ ]?id)|(?:商户|应用)(?:不存在|无效)|商户号错误|(?:pid|app[_ ]?id) (?:is )?invalid/iu' => '商户或应用 ID 无效',
        '/invalid sign(?:ature)?|signature (?:verification )?failed|sign (?:error|incorrect)|签名(?:错误|无效)|验签失败/iu' => '签名验证失败',
        '/(?:ip[^\r\n]{0,30}(?:whitelist|allowlist|not allowed)|ip.{0,15}(?:白名单|不允许))/iu' => '请求 IP 未获网关授权',
        '/no available (?:payment )?channel|channel (?:is )?(?:disabled|unavailable)|(?:暂无|没有)可用(?:支付)?通道|通道(?:关闭|不可用)|渠道(?:关闭|不可用)/iu' => '没有可用的支付通道',
        '/unsupported payment (?:type|method)|(?:不支持|未开通)(?:该|此)?支付方式|支付方式(?:无效|未开通)/iu' => '支付方式未开通或不受支持',
        '/duplicate (?:order|trade)|order already exists|订单(?:已存在|重复)|重复(?:订单|下单)/iu' => '网关提示订单已存在',
        '/invalid amount|amount (?:out of range|too (?:small|large))|金额(?:错误|无效|超限|超出范围)/iu' => '支付金额无效或超出网关范围',
        '/currency (?:is )?(?:unsupported|invalid)|unsupported currency|币种(?:不支持|无效|错误)/iu' => '网关不支持此币种',
        '/invalid (?:notify|return)[_ ]?url|(?:回调|通知|跳转)地址(?:错误|无效)/iu' => '通知或跳转地址无效',
        '/rate limit|too many requests|请求(?:太|过于)频繁|请求限流/iu' => '网关限制请求频率',
        '/order creation failed|failed to create (?:payment|order)|(?:下单|创建订单)失败/iu' => '网关报告下单失败',
        '/\A(?:success|ok|支付下单成功[！!]?|下单成功[！!]?)\z/iu' => '网关返回成功提示',
    ];
    private const SAFE_CODES = ['SUCCESS', 'OK', 'INVALID_PID', 'INVALID_APP_ID', 'INVALID_SIGNATURE', 'SIGN_ERROR', 'PARAM_ERROR', 'CHANNEL_UNAVAILABLE', 'ORDER_EXISTS', 'RATE_LIMITED', 'SYSTEM_ERROR'];

    public static function summarize(mixed $response, string $provider): array
    {
        $format = self::type($response);
        if (is_string($response) && strlen($response) <= 65536 && trim($response) !== '') {
            $decoded = json_decode($response, false, 8);
            if (json_last_error() === JSON_ERROR_NONE) {
                $response = $decoded;
                $format = self::type($response);
            } elseif (str_starts_with(ltrim($response), '<')) {
                $format = 'markup';
            }
        }

        $summary = ['format' => $format, 'fields' => [], 'codes' => [], 'messages' => [], 'unrecognized_message' => false, 'other_fields' => []];
        $expected = $provider === 'MGate' ? ['code', 'data', 'data.trade_no', 'data.pay_url'] : ['code', 'trade_no', 'payurl', 'qrcode', 'urlscheme'];
        $objects = ['' => $response];
        foreach (self::CONTAINERS as $container) {
            if (is_object($response) && is_object($response->{$container} ?? null)) $objects[$container . '.'] = $response->{$container};
        }
        $known = array_flip(array_merge(self::CONTAINERS, self::CODES, self::MESSAGES, self::ACTIONS, self::ORDERS, self::SENSITIVE, self::OTHER));
        foreach ($objects as $prefix => $object) {
            if (!is_object($object)) continue;
            $values = get_object_vars($object);
            $unknown = count(array_diff_key($values, $known));
            if ($unknown) $summary['other_fields'][rtrim($prefix, '.') ?: '$'] = $unknown;
            foreach (array_intersect_key($values, $known) as $field => $value) {
                $path = $prefix . $field;
                $summary['fields'][$path] = self::type($value);
                if (in_array($field, self::SENSITIVE, true)) {
                    $summary['fields'][$path] = 'masked';
                } elseif (in_array($field, self::ACTIONS, true) && $summary['fields'][$path] === 'string') {
                    $summary['fields'][$path] = $provider === 'MGate' && $path === 'data.pay_url' && !self::webUrl($value)
                        ? 'invalid_url' : 'masked';
                }
                if (in_array($field, self::CODES, true)) {
                    if ((is_int($value) || is_string($value)) && preg_match('/\A-?[0-9]{1,9}\z/', (string) $value)) {
                        $summary['codes'][$path] = (int) $value;
                    } elseif (is_string($value) && in_array($value, self::SAFE_CODES, true)) {
                        $summary['codes'][$path] = $value;
                    }
                }
                if (in_array($field, self::MESSAGES, true)) self::messages($summary, $value);
            }
        }
        if (is_string($response) && $format === 'string') self::messages($summary, $response);
        foreach ($expected as $field) $summary['fields'][$field] ??= 'missing';
        $summary['messages'] = array_values(array_unique($summary['messages']));
        return $summary;
    }

    private static function messages(array &$summary, mixed $value, int $depth = 0): void
    {
        if ($depth >= 3) return;
        if (is_array($value) || is_object($value)) {
            foreach (array_slice((array) $value, 0, 12) as $entry) self::messages($summary, $entry, $depth + 1);
            return;
        }
        if (!is_string($value) || trim($value) === '') return;
        foreach (self::SAFE_MESSAGES as $pattern => $label) {
            if (preg_match($pattern, substr($value, 0, 1024)) === 1) {
                $summary['messages'][] = $label;
                return;
            }
        }
        $summary['unrecognized_message'] = true;
    }

    private static function type(mixed $value): string
    {
        if (is_string($value)) return trim($value) === '' ? 'empty' : 'string';
        return match (true) {
            is_object($value) => 'object',
            is_array($value) => 'array',
            is_int($value), is_float($value) => 'number',
            is_bool($value) => 'boolean',
            default => 'null',
        };
    }

    private static function webUrl(string $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_URL) !== false
            && in_array(strtolower(parse_url($value, PHP_URL_SCHEME) ?? ''), ['http', 'https'], true)
            && parse_url($value, PHP_URL_USER) === null && parse_url($value, PHP_URL_PASS) === null;
    }
}
