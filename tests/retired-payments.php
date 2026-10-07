<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
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
    echo "Retired payments: $checks checks passed\n";
} finally { Illuminate\Support\Facades\DB::rollBack(); }
