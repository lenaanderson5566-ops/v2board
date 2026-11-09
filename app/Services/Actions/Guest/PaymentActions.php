<?php

namespace App\Services\Actions\Guest;


use App\Models\Order;
use App\Services\PaymentCallbackHistory;
use App\Services\PaymentGatewayTrace;
use App\Services\OrderService;
use App\Services\PaymentService;
use Illuminate\Http\Request;

class PaymentActions
{
    public function notify($method, $uuid, Request $request)
    {
        $stage = 'channel';
        $verifiedTradeNo = null;
        $trace = new PaymentGatewayTrace();
        $trace->add('回调请求', $request->getMethod() . ' ' . $request->getRequestUri());
        // Browser cookies belong to FastAI sessions, not to the payment gateway protocol.
        $trace->add('回调请求头', array_diff_key($request->headers->all(), ['cookie' => true]));
        $body = $request->getContent();
        $trace->add('回调请求内容', $body);
        if ($body === '' && $request->request->count() > 0) $trace->add('回调表单参数', $request->request->all());
        $record = function ($result, $response, $reason = null) use ($method, $uuid, $request, $trace, &$stage, &$verifiedTradeNo) {
            $trace->add('回调响应', $response);
            $trace->add('回调处理错误', $reason);
            PaymentCallbackHistory::record($method, $uuid, $verifiedTradeNo, $stage, $result, $reason, $request->attributes->get('requestId'), $trace);
        };
        try {
            $paymentService = new PaymentService($method, null, $uuid);
            $stage = 'verification';
            $verify = $trace->run(fn () => $paymentService->notify($request->input()));
            if ($verify === 'success') { $record('acknowledged', 'success'); return 'success'; } // Verified provider event with no settlement.
            if (!is_array($verify) || empty($verify['trade_no']) || empty($verify['callback_no'])) abort(500, 'verify error');
            $verifiedTradeNo = (string) $verify['trade_no'];
            $stage = 'settlement';
            if (!$this->handle($verify['trade_no'], $verify['callback_no'], $method, $uuid, $verify)) {
                abort(500, 'handle error');
            }
            $response = $verify['custom_result'] ?? 'success';
            $record('handled', $response);
            return $response;
        } catch (\Throwable $e) {
            $record('failed', 'fail', $e->getMessage());
            $knownReasons = PaymentCallbackHistory::REASONS;
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
        $snapshot = \App\Services\PaymentSettlement::validate($order, $payment, $verified);
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
        try {
            (new \App\Services\TelegramService())->notifyPaymentAdmins($order);
        } catch (\Throwable $e) {
            // Notification failures must not cause a successful payment to be rejected.
            \Illuminate\Support\Facades\Log::warning('Payment Telegram notification could not be queued');
        }
        return true;
    }
}
