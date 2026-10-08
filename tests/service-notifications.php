<?php
// Local integration test. Queue is faked; committed fixtures are removed in finally.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Models\Giftcard;
use App\Jobs\SendEmailJob;
use App\Services\OrderService;
use App\Services\ServiceNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

Queue::fake();
config(['v2board.new_order_event_id'=>0, 'v2board.renew_order_event_id'=>0, 'v2board.change_order_event_id'=>0]);
$checks=0; $users=[]; $cards=[]; $orders=[]; $plan=null;
$assert=function ($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$count=function () { return Queue::pushed(SendEmailJob::class)->count(); };
$params=function ($job) { $p=new ReflectionProperty($job,'params'); $p->setAccessible(true); return $p->getValue($job); };
$makeUser=function ($attributes=[]) use (&$users) {
    $u=User::create($attributes + ['email'=>Str::uuid().'@example.com', 'password'=>'not-a-login', 'token'=>Str::random(32), 'uuid'=>(string)Str::uuid(), 'expired_at'=>0]);
    $users[]=$u->id; return $u->fresh();
};
try {
    $user=$makeUser();
    $assert($user->remind_service===true, 'New users default to service notifications');
    DB::beginTransaction(); ServiceNotification::schedule($user,false);
    $assert($count()===0,'No job before commit'); DB::rollBack();
    $assert($count()===0,'Rolled back activation has no notification');
    DB::transaction(function () use ($user) { ServiceNotification::schedule($user,false); });
    $assert($count()===1,'Committed activation queues one notification');
    $assert($params(Queue::pushed(SendEmailJob::class)->last())['template_name']==='serviceActivated','Activation template');
    $user->remind_service=false; $user->save();
    $assert((new SendEmailJob(['email'=>$user->email,'template_name'=>'serviceActivated']))->handle()===['skipped'=>true],'Opt-out after enqueue is honored');
    DB::transaction(function () use ($user) { ServiceNotification::schedule($user,true); });
    $assert($count()===1,'Opt-out prevents enqueue');
    $user->remind_service=true; $user->save();
    $plan=Plan::create(['name'=>'Service notification test', 'group_id'=>1, 'transfer_enable'=>100, 'month_price'=>1000, 'show'=>1, 'renew'=>1]);
    foreach ([1,2,3,4,9] as $type) {
        $before=$count();
        $order=Order::create(['user_id'=>$user->id,'plan_id'=>$plan->id,'trade_no'=>'nt'.bin2hex(random_bytes(12)),'period'=>$type===9?'deposit':($type===4?'reset_price':'month_price'),'type'=>$type,'total_amount'=>1000,'status'=>1]);
        $orders[]=$order->id;
        (new OrderService($order))->open();
        $expected=in_array($type,[1,2,3],true)?1:0;
        $assert($order->fresh()->status===3 && $count()===$before+$expected,'Only service orders notify: '.$type);
        if ($expected) $assert($params(Queue::pushed(SendEmailJob::class)->last())['template_name']===($type===2?'serviceRenewed':'serviceActivated'),'Correct order template: '.$type);
        (new OrderService($order))->open();
        $assert($count()===$before+$expected,'Repeated fulfillment does not notify again: '.$type);
    }
    foreach ([1,2,3,4,5] as $type) {
        $recipient=$makeUser($type===5?[]:['plan_id'=>$plan->id,'expired_at'=>time()+86400,'transfer_enable'=>1073741824]);
        $card=Giftcard::create(['name'=>'Test gift card','started_at'=>0,'ended_at'=>0,'code'=>'TEST'.bin2hex(random_bytes(12)),'type'=>$type,'value'=>$type===1?500:2,'plan_id'=>$plan->id,'limit_use'=>2]);
        $cards[]=$card->id; $before=$count();
        $request=App\Http\Requests\User\UserRedeemGiftCard::create('/api/v10/me/gift-card-redemptions','POST',['giftcard'=>$card->code]);
        $request->user=['id'=>$recipient->id]; app()->instance('request',$request);
        $action=new App\Services\Actions\User\UserActions();
        $result=json_decode($action->redeemgiftcard($request)->getContent(),true);
        $assert($result['data']===true && $card->fresh()->limit_use===1,'Gift card fulfilled: '.$type);
        $updated=$recipient->fresh();
        if ($type===1) $assert($updated->balance===500,'Wallet gift adds minor units');
        if ($type===2) $assert($updated->expired_at===$recipient->expired_at+2*86400,'Duration gift extends expiry');
        if ($type===3) $assert($updated->transfer_enable===3*1073741824,'Allowance gift adds bytes');
        if ($type===4) $assert($updated->u===0 && $updated->d===0,'Reset gift clears usage');
        if ($type===5) $assert($updated->plan_id===$plan->id && $updated->expired_at>time(),'Plan gift activates service');
        $assert($card->fresh()->used_user_ids===[$recipient->id],'Used recipients stored as JSON array');
        $assert($count()===$before+(in_array($type,[2,5],true)?1:0),'Only service gift cards notify: '.$type);
        try { $action->redeemgiftcard($request); throw new RuntimeException('Duplicate accepted'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,'Duplicate redemption rejected'); }
        $assert($card->fresh()->limit_use===1,'Duplicate does not decrement card');
    }
    // Historical double-encoded records must still enforce one redemption per user.
    $card->used_user_ids=json_encode([$recipient->id]); $card->save();
    try { $action->redeemgiftcard($request); throw new RuntimeException('Historical duplicate accepted'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,'Historical recipient list respected'); }
    $before=$count();
    $card->used_user_ids=[]; $card->plan_id=0; $card->save();
    $recipient->expired_at=0; $recipient->save();
    try { $action->redeemgiftcard($request); throw new RuntimeException('Missing plan accepted'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===409,'Missing gift plan rejected'); }
    $assert($card->fresh()->limit_use===1 && $count()===$before,'Invalid gift rolls back without notice');
    echo "Service notifications and gift cards: $checks checks passed; no real mail sent.\n";
} finally {
    while (DB::transactionLevel()>0) DB::rollBack();
    Giftcard::whereIn('id',$cards)->delete(); Order::whereIn('id',$orders)->delete();
    User::whereIn('id',$users)->delete(); if ($plan) $plan->delete();
}
