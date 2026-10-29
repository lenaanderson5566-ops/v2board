<?php

namespace App\Services;


use App\Models\Payment;

class PaymentService
{
    public const RETIRED_METHODS = ['Epusdt', 'BEasyPaymentUSDT'];

    public $method;
    protected $class;
    protected $config;
    protected $payment;

    public function __construct($method, $id = NULL, $uuid = NULL)
    {
        abort_if(in_array($method, self::RETIRED_METHODS, true), 404, __('Payment method is not available'));
        $this->method = $method;
        $this->class = '\\App\\Payments\\' . $this->method;
        if (!class_exists($this->class)) abort(500, 'gate is not found');
        if ($id || $uuid) {
            $record = $id ? Payment::find($id) : Payment::where('uuid', $uuid)->first();
            // A callback URL cannot select a different verifier for this channel's secrets.
            abort_unless($record && $record->payment === $method, 404, 'Payment channel not found');
            $payment = $record->toArray();
        }
        $this->config = [];
        if (isset($payment)) {
            $this->config = $payment['config'];
            $this->config['enable'] = $payment['enable'];
            $this->config['id'] = $payment['id'];
            $this->config['uuid'] = $payment['uuid'];
            $this->config['notify_domain'] = $payment['notify_domain'];
        };
        $this->payment = new $this->class($this->config);
    }

    public function notify($params)
    {
        if (!$this->config['enable']) abort(500, 'gate is not enable');
        return $this->payment->notify($params);
    }

    public function pay($order)
    {
        // New payments use V10; historical callbacks remain registered.
        $base = $this->configuredBase();
        $notifyBase = !empty($this->config['notify_domain'])
            ? rtrim($this->config['notify_domain'], '/') : $base;
        $notifyUrl = $notifyBase . "/api/v10/webhooks/payments/{$this->method}/{$this->config['uuid']}";
        // Only persisted subscription context can resume the unified checkout.
        // Older callers and non-subscription orders retain their order-detail return path.
        $planId = (int)($order['plan_id'] ?? 0);
        $subscription = $planId > 0 && array_key_exists('credit_bytes', $order)
            && (int)$order['credit_bytes'] === 0
            && in_array($order['period'] ?? null, ['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price'], true);
        $returnPath = $subscription ? '/#/plan/' . $planId . '?order=' : '/#/order/';
        $returnUrl = $this->currentBase($base) . $returnPath . rawurlencode($order['trade_no']);
        return $this->payment->pay([
            'currency' => $order['currency'] ?? 'CNY',
            'notify_url' => $notifyUrl,
            'return_url' => $returnUrl,
            'trade_no' => $order['trade_no'],
            'total_amount' => $order['total_amount'],
            'user_id' => $order['user_id'],
            'stripe_token' => $order['stripe_token']
        ]);
    }

    public function form()
    {
        $form = $this->payment->form();
        $keys = array_keys($form);
        foreach ($keys as $key) {
            if (isset($this->config[$key])) $form[$key]['value'] = $this->config[$key];
        }
        return $form;
    }

    private function configuredBase(): string
    {
        $base = rtrim((string)(config('v2board.app_url') ?: config('app.url')), '/');
        $parts = parse_url($base);
        abort_unless($parts && in_array($parts['scheme'] ?? '', ['https', 'http'], true)
            && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass'])
            && !isset($parts['query']) && !isset($parts['fragment']), 500, 'Invalid payment base URL');
        return $base;
    }

    private function currentBase(string $fallback): string
    {
        $origin = request()->header('Origin');
        // Native clients have no Origin. Never trust Host or raw forwarding headers.
        $parts = parse_url($fallback);
        $own = $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
        $allowed = array_filter(array_merge([$own], config('cors.allowed_origins', [])), fn($value)=>$value && $value !== '*');
        if ($origin && in_array($origin, $allowed, true)) {
            return rtrim($origin, '/');
        }
        return $fallback;
    }
}
