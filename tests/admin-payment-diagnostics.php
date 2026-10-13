<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment, ClientStrategy};
use App\Services\{PaymentCallbackHistory, ClientStrategyService};
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$n = 0;
$assert = function ($ok, $label) use (&$n) { if (!$ok) throw new RuntimeException($label); $n++; };
DB::beginTransaction();
try {
    $payment = Payment::create(['name'=>'Diagnostic test', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>['pid'=>'test', 'key'=>'test-secret']]);
    $order = Order::create(['user_id'=>1, 'plan_id'=>1, 'type'=>1, 'period'=>'month_price', 'trade_no'=>App\Utils\Helper::generateOrderNo(), 'total_amount'=>1000, 'status'=>0, 'payment_id'=>$payment->id]);
    $requestId = (string) Illuminate\Support\Str::uuid();
    PaymentCallbackHistory::record('PaytaroQR', $payment->uuid, null, 'verification', 'failed', 'verify error', $requestId);
    $history = PaymentCallbackHistory::forOrder($order);
    $assert(count($history['events']) === 0 && count($history['channelEvents']) === 1, 'Unverified callback cannot be attributed to an order');
    PaymentCallbackHistory::record('PaytaroQR', $payment->uuid, $order->trade_no, 'settlement', 'failed', 'secret=should-not-be-stored', $requestId);
    $history = PaymentCallbackHistory::forOrder($order);
    $assert($history['events'][0]->reason === 'internal_error', 'Raw errors are redacted');
    $assert($history['events'][0]->request_id === $requestId, 'Request ID can correlate logs');
    $other = Payment::create(['name'=>'Other channel', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>[]]);
    PaymentCallbackHistory::record('PaytaroQR', $other->uuid, $order->trade_no, 'settlement', 'failed', 'channel mismatch', null);
    $assert(count(PaymentCallbackHistory::forOrder($order)['events']) === 1, 'Unrelated channel does not contaminate order history');
    $request = Request::create('/', 'POST', ['merchant_no'=>$order->trade_no, 'callback_no'=>'fixture', 'status'=>'PAID', 'order_amount'=>1, 'order_currency'=>'CNY']);
    $request->headers->set('X-App-Secret', 'wrong');
    $app->instance('request', $request);
    try { (new App\Services\Actions\Guest\PaymentActions())->notify('PaytaroQR', $payment->uuid, $request); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode() === 500, 'Failed verification keeps provider failure response'); }
    $assert(count(PaymentCallbackHistory::forOrder($order)['events']) === 1, 'Forged order reference remains unassociated');
    $assert($order->fresh()->status === 0, 'Diagnostic recording does not settle an order');
    ClientStrategy::updateOrCreate(['client_type'=>'fastai'], ['client_name'=>'FastAI', 'is_enabled'=>1, 'min_version'=>'v1.3.0']);
    config(['v2board.fastai_releases'=>[['platform'=>'windows', 'architecture'=>'x64', 'minimumVersion'=>'1.2.0', 'latestVersion'=>'1.2.5']]]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $target = $row->effective_minimums[0];
    $assert($target['effectiveMinimum'] === '1.3.0' && !$target['latestAllowed'], 'Effective minimum uses normalized policy and warns when latest is blocked');
    ClientStrategy::where('client_type', 'fastai')->update(['min_version'=>null]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $assert($row->effective_minimums[0]['effectiveMinimum'] === '1.2.0', 'Release minimum applies without policy minimum');
    echo "PASS {$n} admin payment/version checks\n";
} finally { DB::rollBack(); }
