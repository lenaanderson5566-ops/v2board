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
        try {
            $paymentService = new PaymentService($method, null, $uuid);
            $verify = $paymentService->notify($request->input());
            if (!$verify) abort(500, 'verify error');
            if (!$this->handle($verify['trade_no'], $verify['callback_no'], $method, $uuid)) {
                abort(500, 'handle error');
            }
            return(isset($verify['custom_result']) ? $verify['custom_result'] : 'success');
        } catch (\Exception $e) {
            abort(500, 'fail');
        }
    }

    private function handle($tradeNo, $callbackNo, $method, $uuid)
    {
        $order = Order::where('trade_no', $tradeNo)->first();
        if (!$order) {
            abort(500, 'order is not found');
        }
        if ($order->status !== 0) return true;
        $payment = \App\Models\Payment::where('uuid', $uuid)->where('payment', $method)->firstOrFail();
        $snapshot = $order->payment_snapshot['channels'][(string)$payment->id] ?? null;
        if ($snapshot && ($snapshot['uuid'] !== $uuid || $snapshot['provider'] !== $method)) abort(500, 'channel mismatch');
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
        $telegramService->sendMessageWithAdmin($message);
        return true;
    }
}
