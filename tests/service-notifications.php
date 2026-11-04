<?php
// Local integration test. Queue is faked; committed fixtures are removed in finally.
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Models\Giftcard;
use App\Models\Ticket;
use App\Jobs\SendEmailJob;
use App\Http\Controllers\V1\Admin\GiftcardController;
use App\Http\Controllers\V1\Admin\PlanController;
use App\Http\Requests\Admin\GiftcardGenerate;
use App\Services\OrderService;
use App\Services\ServiceNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

Queue::fake();
config(['fastai.new_order_event_id'=>0, 'fastai.renew_order_event_id'=>0, 'fastai.change_order_event_id'=>0]);
$checks=0; $users=[]; $cards=[]; $orders=[]; $plan=null; $deletablePlan=null; $ticket=null;
$assert = \Tests\Support\Assertions::counter($checks);
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
    $ticket = Ticket::create(['user_id'=>$user->id,'subject'=>'Ticket delivery test','level'=>0]);
    $legacyTicketMail = ['email'=>$user->email,'template_name'=>'ticketReply','template_value'=>['ticket_id'=>$ticket->id]];
    $ticketMail = $legacyTicketMail + ['user_id'=>$user->id];
    $assert((new SendEmailJob($ticketMail + ['expires_at'=>time()-1]))->handle() === ['skipped'=>true],
        'Unchanged ticket recipient reaches ordinary expiry check');
    $user->update(['email'=>Str::uuid().'@example.com']);
    foreach ([$ticketMail, $legacyTicketMail] as $job) {
        $assert((new SendEmailJob($job))->handle() === ['skipped'=>true,'reason'=>'TICKET_RECIPIENT_CHANGED'],
            'A queued ticket reply cannot be sent to the old address');
    }
    $plan=Plan::create(['name'=>'Service notification test', 'group_id'=>1, 'transfer_enable'=>100, 'month_price'=>1000, 'show'=>1, 'renew'=>1, 'speed_limit'=>80]);
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
        if ($type===5) $assert($updated->plan_id===$plan->id && $updated->expired_at>time()
            && (int) $updated->speed_limit===80, 'Plan gift activates service with the configured speed limit');
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

    $card->update(['type'=>1, 'value'=>-500]);
    $oldBalance = $recipient->fresh()->balance;
    try { $action->redeemgiftcard($request); throw new RuntimeException('Negative legacy gift accepted'); }
    catch (HttpException $e) { $assert($e->getStatusCode()===409, 'Negative legacy gift is rejected'); }
    $assert($recipient->fresh()->balance===$oldBalance && $card->fresh()->limit_use===1
        && $card->fresh()->used_user_ids===[], 'Negative gift cannot debit the wallet or consume a use');

    $makeGift = function (array $data) {
        $request = GiftcardGenerate::create('/admin/giftcard/generate', 'POST', $data, [], [], ['HTTP_ACCEPT'=>'application/json']);
        $request->setContainer(app())->setRedirector(app('redirect'));
        $request->validateResolved();
        return (new GiftcardController())->generate($request);
    };
    $deletablePlan = Plan::create(['name'=>'Plan reference test', 'group_id'=>1, 'transfer_enable'=>1]);
    $name = 'Plan card '.Str::random(12);
    $input = ['name'=>$name, 'type'=>5, 'value'=>0, 'plan_id'=>$deletablePlan->id, 'started_at'=>0, 'ended_at'=>0];
    foreach ([
        ['type'=>1, 'value'=>-1],
        ['type'=>2, 'value'=>-1],
        ['type'=>3, 'value'=>0],
        ['value'=>-1],
        ['started_at'=>200, 'ended_at'=>100],
        ['plan_id'=>0],
        ['plan_id'=>2147483647],
        ['generate_count'=>-1],
    ] as $invalid) {
        try { $makeGift(array_replace($input, $invalid)); throw new RuntimeException('Invalid gift card saved'); }
        catch (ValidationException $e) { $assert($e->status===422, 'Invalid gift inputs return validation errors'); }
    }
    $assert(!Giftcard::where('name', $name)->exists(), 'Rejected gifts were not issued');
    $assert($makeGift($input)->getStatusCode()===200, 'Permanent plan gift and unbounded card window remain supported');
    $planCard = Giftcard::where('name', $name)->firstOrFail();
    $cards[] = $planCard->id;
    $dropPlan = fn () => (new PlanController())->drop(Request::create('/admin/plan/drop', 'POST', ['id'=>$deletablePlan->id]));
    try { $dropPlan(); throw new RuntimeException('Plan with usable gift card removed'); }
    catch (HttpException $e) { $assert($e->getStatusCode()===409, 'Usable plan gift blocks plan deletion'); }
    $makeGift($input + ['id'=>$planCard->id, 'limit_use'=>0]);
    $assert($planCard->fresh()->limit_use===0 && $planCard->fresh()->code===$planCard->code, 'Editing a gift card keeps its distributed code');
    $trialPlan = config('fastai.try_out_plan_id');
    config(['fastai.try_out_plan_id'=>$deletablePlan->id]);
    try { $dropPlan(); throw new RuntimeException('Configured trial plan removed'); }
    catch (HttpException $e) { $assert($e->getStatusCode()===409, 'Trial configuration blocks plan deletion'); }
    finally { config(['fastai.try_out_plan_id'=>$trialPlan]); }
    $assert($dropPlan()->getStatusCode()===200 && !$deletablePlan->fresh(), 'Exhausted card keeps history without blocking plan deletion');
    echo "Service notifications and gift cards: $checks checks passed; no real mail sent.\n";
} finally {
    while (DB::transactionLevel()>0) DB::rollBack();
    Giftcard::whereIn('id',$cards)->delete(); Order::whereIn('id',$orders)->delete();
    if ($ticket) $ticket->delete();
    User::whereIn('id',$users)->delete(); if ($plan) $plan->delete();
    if ($deletablePlan) $deletablePlan->delete();
}
