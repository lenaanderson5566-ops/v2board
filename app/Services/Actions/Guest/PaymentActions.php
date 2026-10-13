<?php

namespace App\Services\Actions\Guest;


use App\Models\Order;
use App\Services\OrderService;
use App\Services\PaymentService;
use App\Services\TelegramService;
use Illuminate\Http\Request;

class PaymentActions
{
    public function notify($method, $uuid, Request $request)
    {
        $stage = 'channel';
        $verifiedTradeNo = null;
        $record = function ($result, $reason = null) use ($method, $uuid, $request, &$stage, &$verifiedTradeNo) {
            \App\Services\PaymentCallbackHistory::record($method, $uuid, $verifiedTradeNo, $stage, $result, $reason, $request->attributes->get('requestId'));
        };
        try {
            $paymentService = new PaymentService($method, null, $uuid);
            $stage = 'verification';
            $verify = $paymentService->notify($request->input());
            if ($verify === 'success') { $record('acknowledged'); return 'success'; } // Verified provider event with no settlement.
            if (!is_array($verify) || empty($verify['trade_no']) || empty($verify['callback_no'])) abort(500, 'verify error');
            $verifiedTradeNo = (string) $verify['trade_no'];
            $stage = 'settlement';
            if (!$this->handle($verify['trade_no'], $verify['callback_no'], $method, $uuid, $verify)) {
                abort(500, 'handle error');
            }
            $record('handled');
            return(isset($verify['custom_result']) ? $verify['custom_result'] : 'success');
        } catch (\Throwable $e) {
            $record('failed', $e->getMessage());
            $knownReasons = \App\Services\PaymentCallbackHistory::REASONS;
            \Illuminate\Support\Facades\Log::warning('Payment callback failed', [
                'provider' => in_array($method, ['Paytaro', 'PaytaroQR'], true) ? $method : 'other',
                'stage' => $stage,
                'hasAppSecretHeader' => $request->hasHeader('X-App-Secret'),
                'reason' => in_array($e->getMessage(), $knownReasons, true) ? $e->getMessage() : 'internal_error',
                'exceptionClass' => get_class($e),
            ]);
            abort(500, 'fail');
        }
    }

    private function handle($tradeNo, $callbackNo, $method, $uuid, array $verified)
    {
        $order = Order::where('trade_no', $tradeNo)->first();
        if (!$order) {
            abort(500, 'order is not found');
        }
        if ($order->status !== 0 && $method !== 'PaytaroQR') return true;
        $payment = \App\Models\Payment::where('uuid', $uuid)->where('payment', $method)->firstOrFail();
        $snapshot = $order->payment_snapshot['channels'][(string)$payment->id] ?? null;
        if (!$snapshot && (isset($order->payment_snapshot['channels']) || (int)$order->payment_id !== (int)$payment->id)) abort(500, 'channel mismatch');
        if ($snapshot && ($snapshot['uuid'] !== $uuid || $snapshot['provider'] !== $method)) abort(500, 'channel mismatch');
        if (in_array($method, ['EPay', 'Paytaro', 'PaytaroQR', 'StripeCheckout'], true) || array_key_exists('amount', $verified)) {
            $expected = (int)$order->total_amount + (int)($snapshot['handling_amount'] ?? $order->handling_amount);
            if (!isset($verified['amount'], $verified['currency']) || !is_int($verified['amount'])
                || $verified['amount'] !== $expected || strtoupper($verified['currency']) !== ($order->currency ?: 'CNY')) {
                abort(500, 'payment amount mismatch');
            }
        }
        if ($order->status !== 0) return true;
        $context = ['payment_id' => $payment->id, 'payment_snapshot' => null];
        if ($snapshot) {
            $context['handling_amount'] = $snapshot['handling_amount'];
            $context['payment_snapshot'] = json_encode($snapshot, JSON_UNESCAPED_UNICODE);
        }
        $orderService = new OrderService($order);
        if (!$orderService->paid($callbackNo, $context)) {
            return false;
        }
        $telegramService = new TelegramService();
        $message = sprintf(
            "💰成功收款%s\n———————————————\n订单号：%s",
            \App\Services\Money::format($order->total_amount),
            $order->trade_no
        );
        try { $telegramService->sendMessageWithAdmin($message); }
        catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('Payment Telegram notification could not be queued'); }
        return true;
    }
}
