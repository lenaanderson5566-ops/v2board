<?php

/**
 * 自己写别抄，抄NMB抄
 */
namespace App\Payments;

use Stripe\Source;
use Stripe\Stripe;

class StripeWepay {
    private array $config;

    public function __construct($config)
    {
        $this->config = $config;
    }

    public function form()
    {
        return [
            'currency' => [
                'label' => '货币单位',
                'description' => '',
                'type' => 'input',
            ],
            'stripe_sk_live' => [
                'label' => 'SK_LIVE',
                'description' => '',
                'type' => 'input',
            ],
            'stripe_webhook_key' => [
                'label' => 'WebHook密钥签名',
                'description' => '',
                'type' => 'input',
            ]
        ];
    }

    public function pay($order)
    {
        $settlement = \App\Services\LegacyStripeSettlement::payment($order, $this->config);
        $currency = $settlement['currency'];
        Stripe::setApiKey($this->config['stripe_sk_live']);
        $source = Source::create([
            'amount' => $settlement['amount'],
            'currency' => $currency,
            'type' => 'wechat',
            'statement_descriptor' => $order['trade_no'],
            'metadata' => [
                'user_id' => $order['user_id'],
                'out_trade_no' => $order['trade_no'],
                'identifier' => ''
            ],
            'redirect' => [
                'return_url' => $order['return_url']
            ]
        ]);
        if (!$source['wechat']['qr_code_url']) {
            abort(500, __('Payment gateway request failed'));
        }
        return [
            'type' => 0,
            'data' => $source['wechat']['qr_code_url']
        ];
    }

    public function notify($params)
    {
        \Stripe\Stripe::setApiKey($this->config['stripe_sk_live']);
        try {
            $event = \Stripe\Webhook::constructEvent(
                request()->getContent() ?: json_encode($_POST),
                request()->header('Stripe-Signature', ''),
                $this->config['stripe_webhook_key']
            );
        } catch (\Stripe\Exception\SignatureVerificationException | \UnexpectedValueException $e) {
            abort(400);
        }
        switch ($event->type) {
            case 'source.chargeable':
                $object = $event->data->object;
                $charge = \App\Services\LegacyStripeSettlement::source($object, $this->config);
                if ($charge) \Stripe\Charge::create($charge, ['idempotency_key'=>'source-'.hash('sha256', $this->config['uuid'].':'.$object->id)]);
                break;
            case 'charge.succeeded':
                $object = $event->data->object;
                if ($object->status === 'succeeded' && ($object->paid ?? false) && ($object->captured ?? false)) {
                    if (!isset($object->metadata->out_trade_no) && !isset($object->source->metadata)) {
                        return('order error');
                    }
                    $metaData = isset($object->metadata->out_trade_no) ? $object->metadata : $object->source->metadata;
                    $tradeNo = $metaData->out_trade_no;
                    return [
                        'trade_no' => $tradeNo,
                        'callback_no' => $object->id,
                        'amount' => \App\Services\Money::parseMinorUnits($object->amount_captured ?? $object->amount ?? null),
                        'currency' => strtoupper((string)($object->currency ?? ''))
                    ];
                }
                break;
            default:
                abort(500, 'event is not support');
        }
        return('success');
    }

}
