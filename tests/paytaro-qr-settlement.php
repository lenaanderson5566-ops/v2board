<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require __DIR__.'/commerce-bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment};
use Illuminate\Support\Facades\{DB, Queue};
use Illuminate\Http\Request;
Queue::fake();
config(['v2board.telegram_bot_enable'=>0]);
$n = 0;
$assert = function ($ok, $label) use (&$n) { if (!$ok) throw new RuntimeException($label); $n++; };
DB::beginTransaction();
try {
    $payment = Payment::create(['name'=>'QR amount fixture', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>['pid'=>'fixture', 'key'=>'fixture-secret']]);
    $order = Order::create(['user_id'=>1, 'plan_id'=>1, 'type'=>1, 'period'=>'month_price', 'trade_no'=>App\Utils\Helper::generateOrderNo(), 'total_amount'=>32800, 'handling_amount'=>25, 'currency'=>'CNY', 'status'=>0, 'payment_id'=>$payment->id]);
    $order->payment_snapshot = ['channels'=>[(string)$payment->id=>['uuid'=>$payment->uuid, 'provider'=>'PaytaroQR', 'handling_amount'=>25, 'name'=>'Original QR']]];
    $order->save();
    $body = ['merchant_no'=>$order->trade_no, 'callback_no'=>'fixture-paid', 'status'=>'PAID', 'order_amount'=>'328.25', 'order_currency'=>'CNY', 'pay_amount'=>45, 'pay_currency'=>'USDT'];
    $call = function ($patch = [], $secret = 'fixture-secret') use ($app, $payment, $body) {
        $request = Request::create('/api/v10/webhooks/payments/PaytaroQR/'.$payment->uuid, 'POST', [], [], [], ['CONTENT_TYPE'=>'application/json', 'HTTP_X_APP_SECRET'=>$secret], json_encode(array_replace($body, $patch)));
        $app->instance('request', $request);
        return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    };
    foreach ([['order_amount'=>328], ['order_amount'=>329], ['order_currency'=>'USD'], ['order_amount'=>null], ['order_currency'=>null]] as $patch) {
        $response = $call($patch);
        $assert($response->getStatusCode() === 500 && $response->getContent() === 'fail', 'Invalid settlement retains provider failure acknowledgement');
        $assert((int)$order->fresh()->status === 0, 'Rejected callback leaves order unpaid');
    }
    $assert($call([], 'wrong')->getStatusCode() === 500, 'Amount validation cannot bypass secret validation');
    Queue::assertNothingPushed();
    $payment->handling_fee_fixed = 999; $payment->save();
    $response = $call();
    $assert($response->getStatusCode() === 200 && $response->getContent() === 'success', 'Valid callback preserves exact success response');
    $paid = $order->fresh();
    $assert((int)$paid->status === 1 && $paid->callback_no === 'fixture-paid' && (int)$paid->handling_amount === 25, 'Original order fee snapshot governs settlement');
    $response = $call(['status'=>'SUCCESS', 'callback_no'=>'retry']);
    $assert($response->getStatusCode() === 200 && $response->getContent() === 'success', 'Manual retry remains acknowledged');
    $assert($order->fresh()->callback_no === 'fixture-paid', 'Retry does not replace transaction reference');
    Queue::assertPushed(App\Jobs\OrderHandleJob::class, 1);
    $assert($call(['order_amount'=>1])->getStatusCode() === 500, 'A mismatched duplicate is still rejected');
    echo "PASS {$n} PaytaroQR settlement checks\n";
} finally { DB::rollBack(); }
