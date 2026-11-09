<?php
use App\Http\Controllers\V1\Admin\PaymentController;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
use App\Payments\V10TestPayment;
use App\Services\Actions\Guest\PaymentActions;
use App\Services\Actions\User\OrderActions;
use App\Services\CheckoutQuote;
use App\Services\OrderPaymentHistory;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
require __DIR__.'/fixtures/V10TestPayment.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
Illuminate\Support\Facades\DB::beginTransaction();
try {
    $controller=new App\Http\Controllers\V1\Admin\PaymentController();
    $catalog=json_decode($controller->getPaymentMethods()->getContent(),true)['data'];
    $ids=[];
    foreach (App\Services\PaymentService::RETIRED_METHODS as $method) {
        $assert(!in_array($method,$catalog,true),'Removed from gateway catalog');
        $payment=App\Models\Payment::create(['name'=>'retired-test','payment'=>$method,'config'=>[],'uuid'=>bin2hex(random_bytes(4)),'enable'=>1]);$ids[]=$payment->id;
        try { new App\Services\PaymentService($method,$payment->id); throw new RuntimeException('Retired gateway usable'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===404,'Retired gateway rejects payment/callback instantiation'); }
    }
    $methods=json_decode((new App\Services\Actions\User\OrderActions())->getPaymentMethod()->getContent(),true)['data'];
    $assert(!array_intersect($ids,array_column($methods,'id')),'Legacy enabled rows excluded from user list before migration');
    require __DIR__.'/../database/migrations/2026_10_07_000001_disable_retired_payment_methods.php';
    (new DisableRetiredPaymentMethods())->up();
    foreach ($ids as $id) {
        $assert(App\Models\Payment::find($id)->enable===0,'Existing configuration disabled');
        try { $controller->show(Illuminate\Http\Request::create('/','POST',['id'=>$id])); throw new RuntimeException('Retired gateway enabled'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422,'Admin cannot re-enable retired gateway'); }
    }
    (new DisableRetiredPaymentMethods())->down();
    $assert(App\Models\Payment::whereIn('id',$ids)->where('enable',1)->count()===0,'Rollback never re-enables removed gateways');

    // Test the catalog with private adapter files present, without using their implementations.
    $realAppPath = app_path();
    $fakeAppPath = sys_get_temp_dir().'/retired-payment-catalog-'.Str::random(16);
    mkdir($fakeAppPath.'/Payments', 0700, true);
    $catalogFiles = ['MetePay', 'mEtEwXpAy', 'EPay'];
    try {
        foreach ($catalogFiles as $name) touch($fakeAppPath.'/Payments/'.$name.'.php');
        app()->useAppPath($fakeAppPath);
        $catalog = json_decode($controller->getPaymentMethods()->getContent(), true)['data'];
        $assert($catalog === ['EPay'], 'Private Mete adapter files are excluded from discovery');
    } finally {
        app()->useAppPath($realAppPath);
        foreach ($catalogFiles as $name) unlink($fakeAppPath.'/Payments/'.$name.'.php');
        rmdir($fakeAppPath.'/Payments');
        rmdir($fakeAppPath);
    }

    $assertRejected = function (callable $operation, int $status, string $message) use ($assert): void {
        try {
            $operation();
        } catch (HttpExceptionInterface|ValidationException $error) {
            $actual = $error instanceof HttpExceptionInterface ? $error->getStatusCode() : $error->status;
            $assert($actual === $status, $message);
            return;
        }
        throw new RuntimeException($message);
    };
    config(['fastai.app_url' => 'https://panel.example.test']);
    $actions = new OrderActions();
    $plan = Plan::create(['name' => 'Retired checkout', 'group_id' => 1, 'transfer_enable' => 100, 'month_price' => 1000]);
    $user = User::create(['email' => Str::uuid().'@example.test', 'password' => 'test', 'token' => Str::random(32),
        'uuid' => (string) Str::uuid(), 'balance' => 0, 'transfer_enable' => 0, 'expired_at' => 0]);
    $request = Request::create('/api/v10/me/orders/test/payments', 'POST');
    $request->user = ['id' => $user->id];
    app()->instance('request', $request);

    foreach (['MetePay', 'mEtEwXpAy'] as $method) {
        class_alias(V10TestPayment::class, 'App\\Payments\\'.$method);
        $payment = Payment::create(['name' => 'Retired '.$method, 'payment' => $method, 'config' => ['fixture' => 'preserve'],
            'uuid' => Str::random(8), 'enable' => 1, 'currency' => 'CNY']);
        $adminRows = json_decode($controller->fetch()->getContent(), true)['data'];
        $userRows = json_decode($actions->getPaymentMethod($request)->getContent(), true)['data'];
        $assert(!in_array($payment->id, array_column($adminRows, 'id'), true)
            && !in_array($payment->id, array_column($userRows, 'id'), true), 'Archived gateway is absent from channel lists');

        $configRequest = Request::create('/', 'POST', ['id' => $payment->id, 'payment' => $method]);
        $assertRejected(fn () => $controller->getPaymentForm($configRequest), 404, 'Archived gateway has no editable form');
        $assertRejected(fn () => $controller->show($configRequest), 422, 'Archived gateway status cannot be changed');
        $assertRejected(fn () => $controller->drop($configRequest), 422, 'Archived gateway callback credentials cannot be deleted');
        $settings = ['name' => 'Changed', 'payment' => $method, 'config' => ['key' => 'fixture']];
        $assertRejected(fn () => $controller->save(Request::create('/', 'POST', $settings)), 422, 'Archived gateway cannot be created');
        $settings['payment'] = 'EPay';
        $settings['id'] = $payment->id;
        $assertRejected(fn () => $controller->save(Request::create('/', 'POST', $settings)), 422, 'Archived gateway cannot be overwritten with another provider');
        $assert($payment->fresh()->enable === 1 && $payment->fresh()->config === ['fixture' => 'preserve'], 'Archive keeps callback state');

        $order = Order::create(['user_id' => $user->id, 'plan_id' => $plan->id, 'period' => 'month_price',
            'trade_no' => 'mete-'.Str::random(16), 'total_amount' => 1000, 'status' => 0, 'type' => 1]);
        $quote = clone $request;
        $quote->merge(['quote_method' => $payment->id]);
        $assertRejected(fn () => CheckoutQuote::preview($quote, $order, $user), 409, 'Archived gateway does not generate a quote');

        V10TestPayment::$lastOrder = null;
        $checkout = clone $request;
        $key = (string) Str::uuid();
        $checkout->merge(['trade_no' => $order->trade_no, 'method' => $payment->id, 'payment_request_key' => $key]);
        $assertRejected(fn () => $actions->checkout($checkout), 409, 'Archived gateway does not take new payments');
        $assert(V10TestPayment::$lastOrder === null && !$order->fresh()->payment_id, 'Retired checkout never reaches the provider or claims the order');

        $order->payment_id = $payment->id;
        $order->payment_snapshot = [
            'payment_action_key' => $key,
            'payment_attempts' => [$key => [
                'fingerprint' => hash('sha256', json_encode([$payment->id, null, null], JSON_THROW_ON_ERROR)),
                'method' => $payment->id,
                'state' => 'returned',
                'result' => ['type' => 1, 'data' => 'https://gateway.example.test/issued'],
            ]],
        ];
        OrderPaymentHistory::select($order, $payment);
        $assertRejected(fn () => $actions->checkout($checkout), 409, 'Old request key cannot replay a retired payment link');
        $checkout->merge(['resume_payment' => true]);
        $assertRejected(fn () => $actions->checkout($checkout), 409, 'Archived payment link cannot be restored');

        $callback = Request::create('/api/v10/webhooks/payments/'.$method.'/'.$payment->uuid, 'POST', [
            'signature' => 'local-test-signature', 'orderNumber' => $order->trade_no, 'amount' => 1000, 'currency' => 'CNY',
        ]);
        $result = (new PaymentActions())->notify($method, $payment->uuid, $callback);
        $assert($result === 'success' && $order->fresh()->status === 1
            && OrderPaymentHistory::display($order->fresh()) === $payment->name, 'Valid late callback settles the old order and keeps its history');
        $payment->update(['enable' => 0]);
        $assertRejected(fn () => (new PaymentActions())->notify($method, $payment->uuid, $callback),
            500, 'Already-disabled gateways retain their existing callback rejection');
        $assertRejected(fn () => $controller->show($configRequest), 422, 'Archived gateway cannot be re-enabled');
    }

    echo "Retired payments: $checks checks passed\n";
} finally { Illuminate\Support\Facades\DB::rollBack(); }
