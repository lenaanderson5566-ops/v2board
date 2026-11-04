<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if (!getenv('COMMERCE_TEST_DATABASE')) throw new RuntimeException('Requires isolated commerce database');
set_exception_handler(function($e){fwrite(STDERR,get_class($e).': '.$e->getMessage().' at '.basename($e->getFile()).':'.$e->getLine().PHP_EOL);exit(1);});
use Illuminate\Support\Facades\{DB,Schema,Http};
use App\Models\{User,Plan,Order,Payment,Coupon};
use App\Services\{BillingCurrency,ExchangeRate,CouponWallet,OrderService,PaymentQuote};
use App\Services\Actions\User\OrderActions;
use App\Http\Requests\User\OrderSave;
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
if (($argv[1] ?? '')==='install') {
    if(DB::select('SHOW TABLES'))throw new RuntimeException('Requires empty database');
    DB::unprepared(file_get_contents(__DIR__.'/../database/install.sql'));
    preg_match_all('/^\w*MIGRATION=(database\/migrations\/[^\r\n]+)/m',file_get_contents(__DIR__.'/../update.sh'),$matches);
    $paths=array_unique($matches[1]);sort($paths);
    foreach($paths as $path) { $migration=require __DIR__.'/../'.$path; if(is_object($migration))$migration->up(); }
    echo "PASS isolated full installation and update migrations\n";exit;
}
DB::beginTransaction();
try {
    config(['fastai.new_user_currency'=>'CNY','fastai.telegram_bot_enable'=>0,'fastai.deposit_bounus'=>['100:10'],'fastai.invite_commission'=>10,'fastai.withdraw_close_enable'=>0]);
    $user=User::create(['email'=>'legacy-'.uniqid().'@example.test','password'=>'test','token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'balance'=>5000,'transfer_enable'=>0,'expired_at'=>0]);
    $plan=Plan::create(['name'=>'Dual currency fixture','group_id'=>1,'transfer_enable'=>100,'month_price'=>3000,'year_price'=>30000,'show'=>1,'renew'=>1,'usd_prices'=>['month_price'=>500,'year_price'=>5000]]);
    // The plan catalog and direct detail must honor the same switching policy as orders.
    $policyUser=$user->replicate();$policyUser->email='plan-policy-'.uniqid().'@example.test';$policyUser->token=bin2hex(random_bytes(16));$policyUser->uuid=Illuminate\Support\Str::uuid();$policyUser->plan_id=$plan->id;$policyUser->transfer_enable=1073741824;$policyUser->expired_at=time()+86400;$policyUser->save();
    $otherPlan=$plan->replicate();$otherPlan->name='Other visible plan';$otherPlan->save();
    $catalog=new App\Services\Actions\User\PlanActions();
    $planRequest=Illuminate\Http\Request::create('/api/v10/plans','GET',['user'=>['id'=>$policyUser->id]]);
    $planIds=fn()=>array_column(json_decode($catalog->fetch($planRequest)->getContent(),true)['data'],'id');
    config(['fastai.plan_change_enable'=>0]);
    $assert($planIds()===[$plan->id],'Disabled plan switching only exposes the current renewable subscription');
    $plan->show=0;$plan->save();
    $assert($planIds()===[$plan->id],'Hidden current plan remains available for permitted renewal');
    try { $catalog->fetch(Illuminate\Http\Request::create('/api/v10/plans','GET',['user'=>['id'=>$policyUser->id],'id'=>$otherPlan->id]));throw new RuntimeException('Disabled plan detail exposed'); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===409,'Direct detail cannot reopen a disallowed plan switch'); }
    $policyUser->expired_at=time()-1;$policyUser->credit_balance=500;$policyUser->save();
    $assert(!in_array($plan->id,$planIds(),true),'Independent credits do not reopen an expired hidden plan');
    try { $catalog->fetch(Illuminate\Http\Request::create('/api/v10/plans','GET',['user'=>['id'=>$policyUser->id],'id'=>$plan->id]));throw new RuntimeException('Expired hidden plan detail exposed'); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===409,'Direct detail denies expired hidden plan with credits'); }
    $hiddenOrder=OrderSave::create('/api/v10/me/orders','POST',['plan_id'=>$plan->id,'period'=>'month_price']);
    $hiddenOrder->user=['id'=>$policyUser->id];$originalRequest=app('request');app()->instance('request',$hiddenOrder);
    try {
        foreach (['quote','save'] as $action) {
            try { (new OrderActions())->$action($hiddenOrder);throw new RuntimeException('Expired hidden plan allowed '.$action); }
            catch(Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===409,'Expired hidden plan denies '.$action.' with credits'); }
        }
    } finally { app()->instance('request',$originalRequest); }
    $policyUser->credit_balance=0;$policyUser->save();
    $plan->show=1;$plan->save();
    $policyUser->expired_at=time()-1;$policyUser->save();
    $assert(in_array($otherPlan->id,$planIds(),true),'Expired subscriptions may purchase another plan');
    $policyUser->expired_at=time()+86400;$policyUser->transfer_enable=0;$policyUser->save();
    $assert(in_array($otherPlan->id,$planIds(),true),'Accounts without a traffic entitlement may purchase a plan');
    $policyUser->transfer_enable=1073741824;$policyUser->save();config(['fastai.plan_change_enable'=>1]);
    $assert(in_array($otherPlan->id,$planIds(),true),'Enabled switching restores other plans');
    $policyUser->delete();$otherPlan->delete();
    config(['fastai.new_user_currency'=>'USD','fastai.currency'=>'USD']);
    $assert($user->fresh()->currency==='CNY' && $user->fresh()->balance===5000,'Changing new account default changed legacy funds');
    $usd=User::create(['email'=>'usd-'.uniqid().'@example.test','password'=>'test','token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'balance'=>700,'transfer_enable'=>0,'expired_at'=>0]);
    $assert($usd->fresh()->currency==='USD','New account default not applied');
    $assert(BillingCurrency::price($plan,'month_price','CNY')===3000 && BillingCurrency::price($plan,'month_price','USD')===500,'Independent prices');
    $assert(BillingCurrency::price($plan,'reset_price','USD')===null,'Unconfigured USD price must not reuse CNY');
    $save=function(User $u,array $extra=[])use($plan){$r=OrderSave::create('/api/v10/me/orders','POST',$extra+['plan_id'=>$plan->id,'period'=>'month_price']);$r->user=['id'=>$u->id];return Order::where('trade_no',json_decode((new OrderActions)->save($r)->getContent(),true)['data'])->firstOrFail();};
    $roundingUser=new User(['discount'=>10]);$roundingOrder=new Order(['total_amount'=>999]);(new OrderService($roundingOrder))->setVipDiscount($roundingUser);
    $assert($roundingOrder->total_amount===899,'Legacy payable rounding changed');
    $old=$save($user);$assert($old->currency==='CNY' && $old->balance_amount===3000 && $user->fresh()->balance===2000,'Legacy balance purchase uses CNY price');
    $assert((new OrderService($old))->cancel() && $user->fresh()->balance===5000,'CNY cancellation refunds exact units');
    $assert(!(new OrderService($old))->cancel() && $user->fresh()->balance===5000,'Repeated cancellation double refund');
    $new=$save($usd);$assert($new->currency==='USD' && $new->balance_amount===500 && $usd->fresh()->balance===200,'USD wallet purchase');(new OrderService($new))->cancel();
    $user->plan_id=$plan->id;$user->expired_at=time()+86400;$user->save();
    $renew=$save($user);$assert($renew->type===2 && $renew->balance_amount===3000,'Old account renewal price changed');
    (new OrderService($renew))->paid('test-paid');(new OrderService($renew->fresh()))->open();
    $assert($renew->fresh()->status===3 && $user->fresh()->expired_at>time()+25*86400,'Legacy CNY renewal fulfillment');
    $before=$user->fresh()->balance;(new OrderService($renew->fresh()))->open();$assert($user->fresh()->balance===$before,'Duplicate fulfillment changed wallet');
    $originalPhpZone = date_default_timezone_get();
    // Pick a business zone where the fixture is well away from local midnight.
    date_default_timezone_set((int)gmdate('G') < 12 ? 'Asia/Shanghai' : 'America/New_York');
    try {
        $today = new DateTimeImmutable('today');
        $trafficUser = $user->replicate();
        $trafficUser->email = 'renew-traffic-'.uniqid().'@example.test';
        $trafficUser->token = bin2hex(random_bytes(16));
        $trafficUser->uuid = Illuminate\Support\Str::uuid();
        foreach ([[$today->modify('+4 years'), 123, 456], [$today, 0, 0], [$today->modify('-1 day'), 0, 0]] as [$date, $expectedUp, $expectedDown]) {
            $trafficUser->expired_at = $date->setTime(23, 59, 59)->getTimestamp();
            $trafficUser->u = 123;
            $trafficUser->d = 456;
            $trafficUser->traffic_reset_anchor_at = time() - 86400 * 10;
            $trafficUser->save();
            $trafficRenewal = Order::create([
                'user_id' => $trafficUser->id, 'plan_id' => $plan->id,
                'period' => 'month_price', 'trade_no' => bin2hex(random_bytes(16)),
                'total_amount' => BillingCurrency::price($plan, 'month_price', $trafficUser->currency),
                'currency' => $trafficUser->currency, 'status' => 1,
                'type' => 2, 'paid_at' => time(),
            ]);
            (new OrderService($trafficRenewal))->open();
            $trafficUser->refresh();
            $assert((int)$trafficRenewal->fresh()->status === 3
                && (int)$trafficUser->u === $expectedUp && (int)$trafficUser->d === $expectedDown,
                'Renewal preserves usage before the expiration date and resets it at or after expiration');
            $assert(($trafficUser->traffic_reset_anchor_at === null) === ($date < $today),
                'Only an expired renewal discards the old traffic cycle anchor');
        }
    } finally {
        date_default_timezone_set($originalPhpZone);
    }

    $swapAt = time();
    $fundedAt = $swapAt - 86400;
    $paidUntil = strtotime('+1 month', $fundedAt);
    $swapPlan = $plan->replicate();
    $swapPlan->name = 'Replacement subscription fixture';
    $swapPlan->save();
    $swapOwner = User::create([
        'email'=>'proration-'.uniqid().'@example.test', 'password'=>'test', 'token'=>bin2hex(random_bytes(16)),
        'uuid'=>Illuminate\Support\Str::uuid(), 'balance'=>0, 'plan_id'=>$plan->id, 'group_id'=>$plan->group_id,
        'transfer_enable'=>100*1073741824, 'expired_at'=>$paidUntil+60*86400, 'u'=>0, 'd'=>0,
    ]);
    config(['fastai.surplus_enable'=>1]);
    $paidSource = static function (array $overrides = []) use ($swapOwner, $plan, $fundedAt): Order {
        return Order::create($overrides+[
            'user_id'=>$swapOwner->id, 'plan_id'=>$plan->id, 'currency'=>$swapOwner->currency,
            'trade_no'=>bin2hex(random_bytes(16)), 'type'=>1, 'period'=>'month_price', 'status'=>3,
            'total_amount'=>6000, 'balance_amount'=>4000, 'paid_at'=>$fundedAt, 'created_at'=>$fundedAt,
        ]);
    };
    $source = $paidSource();
    $wrongCurrency = $paidSource(['currency'=>$swapOwner->currency==='USD' ? 'CNY' : 'USD']);
    $wrongPlan = $paidSource(['plan_id'=>$swapPlan->id]);
    $unpaidHistory = $paidSource(['paid_at'=>null]);
    $depositHistory = $paidSource(['type'=>9, 'period'=>'deposit']);
    $creditHistory = $paidSource(['type'=>5, 'period'=>'onetime_price', 'credit_bytes'=>1073741824]);
    $resetHistory = $paidSource(['type'=>4, 'period'=>'reset_price']);
    $switch = new Order([
        'user_id'=>$swapOwner->id, 'plan_id'=>$swapPlan->id, 'currency'=>$swapOwner->currency,
        'trade_no'=>bin2hex(random_bytes(16)), 'period'=>'month_price', 'status'=>0,
        'total_amount'=>1000, 'created_at'=>$swapAt,
    ]);
    $switchService = new OrderService($switch);
    $switchService->setOrderType($swapOwner);
    $expectedSurplus = (int)floor(10000 * (($paidUntil-$swapAt)/($paidUntil-$fundedAt)));
    $assert($switch->type===3 && $switch->total_amount===0 && $switch->surplus_amount===$expectedSurplus
        && $switch->refund_amount===$expectedSurplus-1000 && $switch->surplus_order_ids===[$source->id],
        'Gift time, deposits, credits, resets, unpaid history and other plans/currencies cannot inflate paid surplus');
    $assert($switchService->isSurplusQuoteCurrent($swapOwner),'A fresh funded switch quote can be used');
    $swapOwner->u = $swapOwner->transfer_enable;
    $assert(!$switchService->isSurplusQuoteCurrent($swapOwner),'Using the original paid quota invalidates its saved switch credit');
    $swapOwner->save();
    $switch->save();
    $switchCheckout = Illuminate\Http\Request::create('/api/v10/me/orders/checkout', 'POST', [
        'trade_no' => $switch->trade_no, 'payment_request_key' => (string) Illuminate\Support\Str::uuid(),
    ]);
    $switchCheckout->user = ['id' => $swapOwner->id];
    try {
        (new OrderActions())->checkout($switchCheckout);
        throw new RuntimeException('Stale zero-pay switch was accepted');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
        $assert($error->getStatusCode() === 409 && (int)$switch->fresh()->status === 0,
            'A stale switch quote is rejected before payment is recorded');
    }
    $swapOwner->u = 0;
    $swapOwner->save();
    (new OrderActions())->checkout($switchCheckout);
    $switch->refresh();
    $assert((int)$switch->status === 1, 'A valid zero-pay switch can be recorded after checkout revalidation');

    // Historical issued payments may carry overbroad source IDs. Only eligible rows are retired.
    $switch->surplus_order_ids = [$source->id, $wrongCurrency->id, $wrongPlan->id, $unpaidHistory->id,
        $depositHistory->id, $creditHistory->id, $resetHistory->id];
    $switch->status = 1;
    $switch->paid_at = $swapAt;
    $switch->save();
    (new OrderService($switch))->open();
    (new OrderService($switch))->open();
    $assert($switch->fresh()->status===3 && $source->fresh()->status===4 && $swapOwner->fresh()->balance===$expectedSurplus-1000,
        'An issued switch applies the stored wallet refund and retires its funded source once');
    foreach ([$wrongCurrency, $wrongPlan, $unpaidHistory, $depositHistory, $creditHistory, $resetHistory] as $unrelated) {
        $assert($unrelated->fresh()->status===3,'Switch fulfillment preserves unrelated historical order '.$unrelated->id);
    }

    $swapOwner->plan_id = $plan->id;
    $swapOwner->expired_at = null;
    $swapOwner->transfer_enable = 100*1073741824;
    $swapOwner->u = 50*1073741824;
    $swapOwner->d = 0;
    $legacySource = $paidSource(['period'=>'onetime_price', 'total_amount'=>4000, 'balance_amount'=>0]);
    $paidSource(['period'=>'onetime_price', 'type'=>5, 'credit_bytes'=>1073741824, 'paid_at'=>$swapAt, 'total_amount'=>100000]);
    $legacySwap = new Order(['plan_id'=>$swapPlan->id, 'period'=>'month_price', 'total_amount'=>3000, 'created_at'=>$swapAt]);
    (new OrderService($legacySwap))->setOrderType($swapOwner);
    $assert($legacySwap->surplus_amount===2000 && $legacySwap->total_amount===1000
        && $legacySwap->surplus_order_ids===[$legacySource->id],'Legacy permanent-plan credit uses only its paid entitlement source');

    $giftEnd = time()+60*86400;
    $giftOwner = User::create([
        'email'=>'renewal-gift-gap-'.uniqid().'@example.test', 'password'=>'test', 'token'=>bin2hex(random_bytes(16)),
        'uuid'=>Illuminate\Support\Str::uuid(), 'plan_id'=>$plan->id, 'group_id'=>$plan->group_id,
        'transfer_enable'=>100*1073741824, 'expired_at'=>$giftEnd, 'u'=>100*1073741824, 'd'=>0,
    ]);
    $renewal = Order::create([
        'user_id'=>$giftOwner->id, 'plan_id'=>$plan->id, 'currency'=>$giftOwner->currency,
        'trade_no'=>bin2hex(random_bytes(16)), 'type'=>2, 'period'=>'month_price', 'status'=>1,
        'total_amount'=>4000, 'paid_at'=>time(), 'payment_snapshot'=>['name'=>'Settled channel', 'provider'=>'Paytaro'],
    ]);
    (new OrderService($renewal))->open();
    $renewal->refresh();
    $giftOwner->refresh();
    $renewedTerm = $renewal->payment_snapshot['subscription_term'];
    $assert($renewedTerm['starts_at']===$giftEnd && $renewedTerm['ends_at']===$giftOwner->expired_at
        && $renewedTerm['quota_bytes']===100*1073741824
        && $renewal->payment_snapshot['name']==='Settled channel',
        'Fulfilled early renewal stores its exact paid term after the gift gap and preserves payment metadata');
    $giftSwap = new Order(['plan_id'=>$swapPlan->id, 'period'=>'month_price', 'total_amount'=>5000]);
    (new OrderService($giftSwap))->setOrderType($giftOwner);
    $assert($giftSwap->surplus_amount===4000 && $giftSwap->surplus_order_ids===[$renewal->id],
        'An exhausted gift interval does not consume a fully paid renewal that starts in the future');
    $displayOrder = new Order(['payment_id'=>1, 'total_amount'=>1000]);
    OrderService::recordSubscriptionTerm($displayOrder, $giftEnd, $giftOwner->expired_at, 100*1073741824);
    $displayPayment = new Payment(['name'=>'Fallback channel', 'payment'=>'Paytaro']);
    $assert(App\Services\OrderPaymentHistory::display($displayOrder,$displayPayment)==='Fallback channel（当前渠道信息）',
        'Term-only metadata does not hide the existing payment-channel fallback');

    $user->refresh();$user->currency='USD';try{$user->save();throw new RuntimeException('Currency changed');}catch(InvalidArgumentException $e){$checks++;}$user->refresh();
    $coupon=Coupon::create(['name'=>'Ten percent','code'=>uniqid(),'type'=>2,'value'=>10,'show'=>1,'public_claim'=>1,'limit_use'=>2,'started_at'=>time()-10,'ended_at'=>time()+3600]);
    $wallet=CouponWallet::issue($user->id,$coupon->id);$assert(CouponWallet::issue($user->id,$coupon->id)===$wallet && $coupon->fresh()->limit_use===1,'Claim replay consumes stock');
    $coupon->value=50;$coupon->save();$discount=$save($user,['wallet_coupon_id'=>$wallet]);
    $assert($discount->discount_amount===300 && DB::table('v2_coupon_wallet')->where('id',$wallet)->value('order_id')===$discount->id,'Issued terms were not frozen');
    (new OrderService($discount))->cancel();$assert(DB::table('v2_coupon_wallet')->where('id',$wallet)->value('order_id')===null,'Cancellation did not release coupon');
    try{$save($usd,['wallet_coupon_id'=>$wallet]);throw new RuntimeException('Foreign coupon accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Coupon ownership error');}
    $issued=CouponWallet::issue($usd->id,$coupon->id,1);$assert($coupon->fresh()->limit_use===0 && $issued!==$wallet,'Admin issue reserves stock');
    $coupon->public_claim=0;$coupon->save();$assert(CouponWallet::issue($usd->id,$coupon->id,1)===$issued,'Admin issue idempotency');
    Http::fake(['open.er-api.com/*'=>Http::response(['result'=>'success','base_code'=>'USD','rates'=>['CNY'=>7.25],'time_last_update_unix'=>time()])]);
    DB::table('v2_exchange_rate')->where('id',1)->update(['automatic_day'=>null,'attempted_at'=>null]);
    $assert(ExchangeRate::refresh(),'Initial rate fetch');$assert(!ExchangeRate::refresh(),'Automatic fetch repeated');Http::assertSentCount(1);
    $rate=ExchangeRate::snapshot();$assert(ExchangeRate::convert(500,'USD','CNY',$rate)===3625,'USD to CNY integer conversion');
    $assert(ExchangeRate::convert(3625,'CNY','USD',$rate)===500,'CNY to USD conversion');
    $payment=Payment::create(['name'=>'CNY channel','payment'=>'Paytaro','uuid'=>uniqid(),'enable'=>1,'config'=>['pid'=>'fixture','key'=>'fixture-secret'],'handling_fee_fixed'=>0]);
    $unpaid=new Order(['currency'=>'USD','total_amount'=>500]);$quote=PaymentQuote::make($unpaid,$payment);$assert($quote['payment_amount']===3625 && $quote['payment_currency']==='CNY','Converted payment quote');
    $payment->handling_fee_fixed=100;$payment->save();
    $assert(PaymentQuote::make($unpaid,$payment)['payment_amount']===3725,'Fixed fee must remain exact in channel currency');
    $payment->handling_fee_fixed=0;$payment->save();
    $legacy=new Order(['currency'=>'CNY','total_amount'=>32800]);$assert(PaymentQuote::make($legacy,$payment)['payment_amount']===32800,'CNY amount changed');

    // Real provider signing and settlement contract, with no outbound payment transport.
    $paymentOrder=Order::create(['currency'=>'USD','user_id'=>$usd->id,'plan_id'=>0,'period'=>'deposit','type'=>9,'trade_no'=>'fx-'.uniqid(),'total_amount'=>500,'status'=>0]);
    $checkout=function(array $extra=[])use($paymentOrder,$payment){$r=Illuminate\Http\Request::create('/','POST',$extra+['trade_no'=>$paymentOrder->trade_no,'method'=>$payment->id]);$r->user=['id'=>$paymentOrder->user_id];return (new OrderActions)->checkout($r);};
    try{$checkout();throw new RuntimeException('Unconfirmed conversion accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Conversion requires amount confirmation');}
    $result=json_decode($checkout(['expected_payment_amount'=>3625,'expected_payment_currency'=>'CNY'])->getContent(),true);
    parse_str(parse_url($result['data'],PHP_URL_QUERY),$payParams);
    $assert($payParams['money']==='36.25','Provider did not receive converted amount');
    $assert($paymentOrder->fresh()->payment_snapshot['payment_currency']==='CNY','Payment currency not snapshotted');
    DB::table('v2_exchange_rate')->where('id',1)->update(['usd_cny_micros'=>8000000]);
    $assert(PaymentQuote::make($paymentOrder->fresh(),$payment)['payment_amount']===3625,'Rate refresh repriced issued payment');
    $notify=function(string $amount,string $callback)use($paymentOrder,$payment){
        $params=['out_trade_no'=>$paymentOrder->trade_no,'trade_no'=>$callback,'trade_status'=>'TRADE_SUCCESS','money'=>$amount];ksort($params);
        $pairs=[];foreach($params as $k=>$v)$pairs[]=$k.'='.$v;$params['sign']=md5(implode('&',$pairs).'fixture-secret');
        return (new App\Services\Actions\Guest\PaymentActions)->notify('Paytaro',$payment->uuid,Illuminate\Http\Request::create('/','POST',$params));
    };
    try{$notify('5.00','wrong');throw new RuntimeException('Wrong settlement amount accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($paymentOrder->fresh()->status===0,'Wrong amount changed order status');}
    $assert($notify('36.25','correct')==='success','Converted CNY callback rejected');
    $walletBefore=$usd->fresh()->balance;(new OrderService($paymentOrder->fresh()))->open();
    $assert($usd->fresh()->balance===$walletBefore+500,'Converted payment credited wrong currency or bonus');
    $assert($notify('36.25','retry')==='success','Callback retry rejected');(new OrderService($paymentOrder->fresh()))->open();
    $assert($usd->fresh()->balance===$walletBefore+500,'Duplicate callback duplicated wallet credit');
    $assert($paymentOrder->fresh()->currency==='USD','Callback relabelled order currency');
    // A failed refresh retains the last successful quote and attempts only once that UTC day.
    Http::swap(new Illuminate\Http\Client\Factory);Http::preventStrayRequests();Http::fake(['open.er-api.com/*'=>Http::response([],503)]);
    DB::table('v2_exchange_rate')->where('id',1)->update(['automatic_day'=>null,'attempted_at'=>null]);
    $assert(!ExchangeRate::refresh() && !ExchangeRate::refresh(),'Failed automatic fetch retried');Http::assertSentCount(1);
    $assert(ExchangeRate::snapshot()['usdCnyMicros']===8000000,'Failed refresh discarded successful quote');
    DB::table('v2_exchange_rate')->where('id',1)->update(['quoted_at'=>time()-8*86400]);
    $assert(PaymentQuote::make($legacy,$payment)['payment_amount']===32800,'CNY checkout depends on FX availability');
    try{PaymentQuote::make($unpaid,$payment);throw new RuntimeException('Expired FX accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===503,'Stale quote error');}

    $auth=(new App\Services\AuthService($user))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $usdAuth=(new App\Services\AuthService($usd))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
    $call=function(string $path, ?array $body=null, ?string $token=null)use($kernel,$app){
        $r=Illuminate\Http\Request::create('/api/v10/'.$path,$body===null?'GET':'POST',$body??[],[],[],['REMOTE_ADDR'=>'192.0.2.156']);
        $r->headers->set('Accept','application/json');if($token)$r->headers->set('Authorization','Bearer '.$token);
        $app->instance('request',$r);$response=$kernel->handle($r);return [$response,json_decode($response->getContent(),true)];
    };
    [$r]=$call('me/coupons');$assert($r->getStatusCode()===401,'Wallet exposed without authentication');
    [$r,$data]=$call('me/coupons',null,$auth);$assert($r->getStatusCode()===200 && $data['data'][0]['id']===$wallet,'Wallet API owner projection');
    $assert(!str_contains(json_encode($data),'administrator_id') && !isset($data['data'][0]['code']),'Coupon API leaks internal metadata');
    [$r,$data]=$call('me',null,$usdAuth);$assert($r->getStatusCode()===200 && $data['data']['currency']==='USD','Account API wrong currency');
    [$r,$data]=$call('me',null,$auth);$assert($data['data']['currency']==='CNY','Legacy account API relabelled');
    [$r,$data]=$call('plans',null,$usdAuth);$assert($r->getStatusCode()===200 && collect($data['data'])->firstWhere('id',$plan->id)['monthlyPrice']===500,'USD plan resource not independently priced');
    [$r,$data]=$call('plans',null,$auth);$assert(collect($data['data'])->firstWhere('id',$plan->id)['monthlyPrice']===3000,'CNY plan resource changed');
    [$r]=$call('payment-methods?orderNumber='.$paymentOrder->trade_no,null,$auth);$assert($r->getStatusCode()===404,'Foreign order quotation disclosed');
    foreach (['couponCode','coupon_code'] as $retiredField) {
        [$r]=$call('me/orders',['planId'=>1,'billingPeriod'=>'monthly',$retiredField=>'historical-record'],$auth);
        $assert($r->getStatusCode()===422,'Retired coupon field must be rejected, not silently ignored');
    }
    [$r]=$call('me/coupon-claims',['couponId'=>-1],$auth);$assert($r->getStatusCode()===422,'Invalid coupon id accepted');

    DB::table('v2_exchange_rate')->where('id',1)->update(['quoted_at'=>time(),'usd_cny_micros'=>8000000]);
    config(['fastai.commission_distribution_enable'=>1,'fastai.commission_distribution_l1'=>20,
        'fastai.commission_distribution_l2'=>30,'fastai.commission_distribution_l3'=>50]);
    [$preferencesResponse, $preferences] = $call('me/preferences/options', null, $auth);
    $preferences = $preferences['data'] ?? [];
    $assert($preferencesResponse->getStatusCode()===200 && ($preferences['commissionDistributionEnabled'] ?? null)===false
        && array_key_exists('commissionLevelOne', $preferences) && $preferences['commissionLevelOne']===null,
        'Existing clients must see multi-level commission disabled despite historical configuration');
    $adminInvite = json_decode((new App\Http\Controllers\V1\Admin\ConfigController)->fetch(
        Illuminate\Http\Request::create('/', 'GET', ['key'=>'invite']))->getContent(), true)['data']['invite'];
    $assert(!isset($adminInvite['commission_distribution_enable'])
        && !array_key_exists('commission_distribution_enable', App\Http\Requests\Admin\ConfigSave::allRules()),
        'Admin configuration can still activate the retired split');
    $user->refresh();$user->commission_type=1;$user->save();$usd->refresh();$usd->invite_user_id=$user->id;$usd->save();
    $previousInviter = $user->invite_user_id;
    $user->update(['invite_user_id'=>$usd->id]);
    $directBuyer = User::create(['email'=>'direct-referral-'.uniqid().'@example.test','password'=>'test',
        'token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'invite_user_id'=>$user->id]);
    $directQuote = new Order(['user_id'=>$directBuyer->id,'currency'=>'CNY','total_amount'=>500]);
    (new OrderService($directQuote))->setInvite($directBuyer);
    $assert((int)$directQuote->commission_balance===50 && $directQuote->fx_snapshot===null,
        'A different-currency ancestor must not influence a same-currency direct referral');
    $user->update(['invite_user_id'=>$previousInviter]);
    [, $referralsBefore] = $call('me/referrals', null, $auth);
    $commissionOrder=new Order(['user_id'=>$usd->id,'currency'=>'USD','plan_id'=>$plan->id,'type'=>1,'period'=>'month_price','trade_no'=>'commission-'.uniqid(),'total_amount'=>500,'status'=>3]);
    (new OrderService($commissionOrder))->setInvite($usd);$commissionOrder->save();
    $assert((int)$commissionOrder->commission_balance===50 && $commissionOrder->fx_snapshot['usdCnyMicros']===8000000,'Cross-currency commission snapshot');
    [$referralsResponse, $referrals] = $call('me/referrals', null, $auth);
    $assert($referralsResponse->getStatusCode()===200
        && $referrals['data']['pendingCommission']===$referralsBefore['data']['pendingCommission']+400,
        'Pending commission must show the full direct amount in the inviter currency');
    $commissionBefore=$user->fresh()->commission_balance;
    (new App\Console\Commands\CheckCommission)->payHandle($user->id,$commissionOrder);
    $assert($user->fresh()->commission_balance===$commissionBefore+400,'USD commission was mixed into CNY wallet');
    $log=App\Models\CommissionLog::where('trade_no',$commissionOrder->trade_no)->firstOrFail();
    $assert($log->currency==='CNY' && $log->order_currency==='USD' && (int)$log->get_amount===400,'Commission audit lost denomination');
    $commissionOrder->commission_status=1;$commissionOrder->save();
    $transactionLevel=DB::transactionLevel();$beforeFailure=$user->fresh()->commission_balance;
    $failingSettlement=new class extends App\Console\Commands\CheckCommission {
        public function payHandle($inviteUserId, Order $order) { User::whereKey($inviteUserId)->increment('commission_balance',123); throw new RuntimeException('fixture failure'); }
    };
    $failingSettlement->autoPayCommission();
    $assert(DB::transactionLevel()===$transactionLevel && $user->fresh()->commission_balance===$beforeFailure && $commissionOrder->fresh()->commission_status===1,'Failed commission did not roll back atomically');
    $commissionOrder->commission_status=2;$commissionOrder->save();
    $user->refresh();$user->auto_renewal=1;$user->balance=6000;$user->expired_at=time()+3600;$user->save();
    $autoRenewalStartedAt=time();
    (new App\Console\Commands\CheckRenewal)->handle();
    $assert($user->fresh()->balance===3000 && $user->fresh()->currency==='CNY','Automatic renewal changed original CNY price');
    $assert($user->fresh()->expired_at>time()+25*86400,'Automatic renewal did not extend service');
    $autoRenewal=Order::where('user_id',$user->id)->latest('id')->firstOrFail();
    $assert((int)$autoRenewal->status===3 && (int)$autoRenewal->type===2 && (int)$autoRenewal->paid_at>=$autoRenewalStartedAt && (int)$autoRenewal->paid_at<=time(),'Automatic wallet renewal records its payment confirmation time');
    (new App\Console\Commands\CheckRenewal)->handle();$assert($user->fresh()->balance===3000,'Automatic renewal repeated debit');

    $renewalCommand = new App\Console\Commands\CheckRenewal;
    $renewalExpiry = time() + 3600;
    $user->refresh()->update(['auto_renewal'=>1, 'balance'=>6000, 'expired_at'=>$renewalExpiry]);
    $renewalOtherPlan = $plan->replicate();
    $renewalOtherPlan->name = 'Unrelated renewal history';
    $renewalOtherPlan->save();
    $planSwitch = Order::create(['user_id'=>$user->id, 'plan_id'=>$renewalOtherPlan->id, 'currency'=>'CNY',
        'period'=>'year_price', 'trade_no'=>'auto-conflict-'.uniqid(), 'total_amount'=>30000, 'type'=>3, 'status'=>0]);
    foreach ([0, 1] as $blockingStatus) {
        $planSwitch->update(['status'=>$blockingStatus]);
        $renewalStatus = $renewalCommand->handle();
        $account = $user->fresh();
        $assert((int)$account->balance === 6000 && (int)$account->expired_at === $renewalExpiry && (int)$account->auto_renewal === 1,
            'Automatic renewal charged the account while a switch was unpaid or awaiting fulfillment');
        $assert($renewalStatus === 0, 'Waiting for a pending plan switch was treated as a failed renewal');
    }
    $planSwitch->update(['status'=>2]);
    $user->update(['banned'=>1]);
    $assert($renewalCommand->handle() === 0 && (int)$user->fresh()->balance === 6000 && (int)$user->fresh()->expired_at === $renewalExpiry,
        'Automatic renewal charged a banned account');

    $user->update(['banned'=>0, 'balance'=>2800, 'discount'=>10]);
    Order::create(['user_id'=>$user->id, 'plan_id'=>$renewalOtherPlan->id, 'currency'=>'CNY',
        'period'=>'year_price', 'trade_no'=>'unrelated-history-'.uniqid(), 'total_amount'=>30000, 'type'=>3,
        'status'=>3, 'created_at'=>time()+1]);
    $orderCount = Order::where('user_id', $user->id)->count();
    $failAutomaticOrder = true;
    Order::creating(function (Order $order) use ($user, &$failAutomaticOrder) {
        if ($failAutomaticOrder && (int)$order->user_id === (int)$user->id) {
            $failAutomaticOrder = false;
            throw new RuntimeException('fixture automatic order write failure');
        }
    });
    $beforeRenewalTransaction = DB::transactionLevel();
    $assert($renewalCommand->handle() === 1 && DB::transactionLevel() === $beforeRenewalTransaction, 'Automatic renewal leaked a failed transaction');
    $account = $user->fresh();
    $assert((int)$account->balance === 2800 && (int)$account->expired_at === $renewalExpiry && (int)$account->auto_renewal === 1
        && Order::where('user_id', $user->id)->count() === $orderCount, 'Failed automatic renewal did not roll back the wallet and entitlement');
    $assert($renewalCommand->handle() === 0, 'Automatic renewal could not recover after the order write failure');
    $account = $user->fresh();
    $discountedRenewal = Order::where('user_id', $user->id)->latest('id')->firstOrFail();
    $assert((int)$account->balance === 100 && (int)$account->expired_at === strtotime('+1 month', $renewalExpiry)
        && (int)$discountedRenewal->plan_id === (int)$plan->id && $discountedRenewal->period === 'month_price'
        && (int)$discountedRenewal->balance_amount === 2700 && (int)$discountedRenewal->discount_amount === 300,
        'Automatic renewal ignored the current plan history or applicable wallet discount');
    $renewalTerm = $discountedRenewal->payment_snapshot['subscription_term'];
    $assert($renewalTerm['starts_at'] === $renewalExpiry && $renewalTerm['ends_at'] === (int)$account->expired_at
        && $renewalTerm['quota_bytes'] === (int)$account->transfer_enable,
        'Automatic renewal did not persist the exact added term and allowance');

    $stripeClient=new class implements Stripe\HttpClient\ClientInterface {
        public array $calls=[];
        public function request($method,$url,$headers,$params,$hasFile){
            $this->calls[]=$params;
            return [json_encode(['id'=>'cs_test_fixture','object'=>'checkout.session','url'=>'https://checkout.example.test/session']),200,[]];
        }
    };
    Stripe\ApiRequestor::setHttpClient($stripeClient);
    $stripe=new App\Payments\StripeCheckout(['stripe_sk_live'=>'sk_test_fixture']);
    foreach(['CNY','USD'] as $currency){
        $result=$stripe->pay(['currency'=>$currency,'total_amount'=>500,'trade_no'=>'stripe-fixture','return_url'=>'https://example.test/order']);
        $params=end($stripeClient->calls);$assert($params['line_items'][0]['price_data']['currency']===strtolower($currency) && $params['line_items'][0]['price_data']['unit_amount']===500,'Stripe denomination/amount changed');
        $assert($result['type']===1,'Stripe payment response protocol changed');
    }

    $qrChannel=Payment::create(['name'=>'Converted QR','payment'=>'PaytaroQR','uuid'=>uniqid(),'enable'=>1,'config'=>['pid'=>'fixture','key'=>'qr-fixture-secret']]);
    $qrOrder=Order::create(['currency'=>'USD','user_id'=>$usd->id,'plan_id'=>0,'period'=>'deposit','type'=>9,'trade_no'=>'qr-fx-'.uniqid(),'total_amount'=>500,'status'=>0,'payment_id'=>$qrChannel->id]);
    $qrQuote=PaymentQuote::make($qrOrder,$qrChannel);$qrOrder->handling_amount=$qrQuote['handling_amount'];App\Services\OrderPaymentHistory::select($qrOrder,$qrChannel,$qrQuote);
    $qrBody=['merchant_no'=>$qrOrder->trade_no,'callback_no'=>'qr-paid','status'=>'PAID','order_amount'=>'40.00','order_currency'=>'CNY'];
    $qrCall=function()use($qrChannel,$qrBody,$app){$r=Illuminate\Http\Request::create('/','POST',$qrBody);$r->headers->set('X-App-Secret','qr-fixture-secret');$app->instance('request',$r);return(new App\Services\Actions\Guest\PaymentActions)->notify('PaytaroQR',$qrChannel->uuid,$r);};
    $assert($qrCall()==='success','Converted QR callback failed');(new OrderService($qrOrder->fresh()))->open();
    $qrBalance=$usd->fresh()->balance;$assert($qrCall()==='success','Converted QR retry lost winning snapshot');
    (new OrderService($qrOrder->fresh()))->open();$assert($usd->fresh()->balance===$qrBalance,'Converted QR retry credited twice');
    echo "Commerce integration: $checks checks passed; database transaction rolled back.\n";
} finally {DB::rollBack();}
