<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Services\OrderService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Http\Requests\User\OrderSave;
use App\Services\Actions\User\OrderActions as OrderController;
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
try {
 $plan = Plan::create(['name'=>'Replacement test','group_id'=>1,'transfer_enable'=>100,'month_price'=>1000,'year_price'=>9000,'show'=>1,'renew'=>1]);
 $user = User::create(['email'=>Str::uuid().'@example.com','password'=>'test','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>1500,'transfer_enable'=>0,'expired_at'=>0]);
 $save = function ($body) use ($user) {
   $request = OrderSave::create('/', 'POST', $body);
   $request->user = ['id'=>$user->id];
   return json_decode((new OrderController())->save($request)->getContent(), true)['data'];
 };
 $old = $save(['plan_id'=>$plan->id,'period'=>'month_price']);
 $assert($user->fresh()->balance === 500, 'Initial balance reservation');
 try { $save(['plan_id'=>$plan->id,'period'=>'year_price','replace_trade_no'=>$old,'coupon_code'=>'nonexistent-test-coupon']); throw new RuntimeException('Retired coupon code accepted'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 422, 'Retired code must reject replacement'); }
 try { $save(['plan_id'=>$plan->id,'period'=>'year_price','replace_trade_no'=>$old,'wallet_coupon_id'=>PHP_INT_MAX]); throw new RuntimeException('Invalid wallet coupon accepted'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Invalid wallet coupon must fail after replacement cancellation'); }
 $assert(Order::where('trade_no',$old)->first()->status === 0 && $user->fresh()->balance === 500, 'Failed replacement must restore order and balance');
 $new = $save(['plan_id'=>$plan->id,'period'=>'year_price','replace_trade_no'=>$old]);
 $previous = Order::where('trade_no',$old)->firstOrFail();
 $next = Order::where('trade_no',$new)->firstOrFail();
 $assert($previous->status === 2, 'Previous order cancelled');
 $assert($next->balance_amount === 1500 && $next->total_amount === 7500 && $user->fresh()->balance === 0, 'Returned balance applied exactly once');
 (new OrderService($previous))->paid('late-test');
 $assert($previous->fresh()->status === 2, 'Stale callback must not reopen replaced order');
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$old]); throw new RuntimeException('Duplicate replacement accepted'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Duplicate conflict'); }
 $next->payment_id=1; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Issued payment replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Issued payment protected'); }
 $next->payment_id=null; $next->status=1; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Paid order replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Paid order protected'); }

 // Unified checkout quotes are pure reads, and order/payment retries are durable.
 $quoteUser = User::create(['email'=>Str::uuid().'@example.com','password'=>'test','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>200,'transfer_enable'=>0,'expired_at'=>0]);
 $channel = App\Models\Payment::create(['name'=>'Quote test','payment'=>'EPay','uuid'=>Str::random(8),'enable'=>1,'currency'=>'CNY','handling_fee_percent'=>0,'handling_fee_fixed'=>20,'config'=>['key'=>'must-not-be-public']]);
 $coupon = App\Models\Coupon::create(['name'=>'Quote coupon','code'=>Str::random(16),'type'=>2,'value'=>10,'show'=>1,'public_claim'=>1,'started_at'=>time()-60,'ended_at'=>time()+3600,'limit_plan_ids'=>[],'limit_period'=>[]]);
 $walletId = App\Services\CouponWallet::issue($quoteUser->id,$coupon->id);
 $requestFor = function(array $body, $owner = null) use ($quoteUser) {
   $r=OrderSave::create('/api/v10/me/checkout-quotes','POST',$body); $r->user=['id'=>($owner ?: $quoteUser)->id]; app()->instance('request',$r); return $r;
 };
 $actions=new OrderController();
 $selection=['plan_id'=>$plan->id,'period'=>'month_price','wallet_coupon_id'=>$walletId,'quote_method'=>$channel->id];
 $count=Order::where('user_id',$quoteUser->id)->count();
 $quote=json_decode($actions->quote($requestFor($selection))->getContent(),true)['data'];
 $assert($quote['plan_amount']===1000 && $quote['discount_amount']===100 && $quote['balance_amount']===200 && $quote['payment_amount']===720,'Quote includes integer coupon, balance and channel fee');
 $assert(Order::where('user_id',$quoteUser->id)->count()===$count && $quoteUser->fresh()->balance===200 && DB::table('v2_coupon_wallet')->where('id',$walletId)->value('order_id')===null,'Preview does not create orders or reserve assets');
 $assert(!str_contains(json_encode($quote),'must-not-be-public'),'Quote methods never expose provider credentials');
 $body=$selection+['checkout_quote'=>$quote['quote_token'],'checkout_request_key'=>(string)Str::uuid()];
 $tampered=$body; $tampered['checkout_quote'].='invalid';
 try {$actions->save($requestFor($tampered));throw new RuntimeException('Tampered quote accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Tampered quote rejected');}
 $payload=json_decode(Illuminate\Support\Facades\Crypt::decryptString($quote['quote_token']),true);$payload['expires']=time()-1;
 $expired=$body;$expired['checkout_quote']=Illuminate\Support\Facades\Crypt::encryptString(json_encode($payload));
 try {$actions->save($requestFor($expired));throw new RuntimeException('Expired quote accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Expired quote rejected before asset changes');}
 $quoteUser->balance=300;$quoteUser->save();
 try {$actions->save($requestFor($body));throw new RuntimeException('Changed balance accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Changed quote requires reconfirmation');}
 $assert(Order::where('user_id',$quoteUser->id)->count()===$count && $quoteUser->fresh()->balance===300 && DB::table('v2_coupon_wallet')->where('id',$walletId)->value('order_id')===null,'Rejected quote preserves orders, balance and coupon');
 $quoteUser->balance=200;$quoteUser->save();
 try {$actions->save($requestFor($body,$user));throw new RuntimeException('Foreign quote accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Quote bound to authenticated owner');}

 $channel->name='Changed channel';$channel->save();
 try {$actions->save($requestFor($body));throw new RuntimeException('Changed channel identity accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Changed channel identity requires confirmation');}
 $channel->name='Quote test';$channel->save();

 $created=json_decode($actions->save($requestFor($body))->getContent(),true)['data'];
 $replay=json_decode($actions->save($requestFor($body))->getContent(),true)['data'];
 $assert($created===$replay && Order::where('user_id',$quoteUser->id)->count()===$count+1 && $quoteUser->fresh()->balance===0,'Repeated creation returns same order with one reservation');
 $sameKey=$body;$sameKey['checkout_quote']=$expired['checkout_quote'];
 try {$actions->save($requestFor($sameKey));throw new RuntimeException('Request key reuse accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Same key rejects changed quote');}
 $createdOrder=Order::where('trade_no',$created)->firstOrFail();
 $assert(App\Services\PaymentQuote::make($createdOrder,$channel)['payment_amount']===720,'Created order locks confirmed channel quote');
 $assert(App\Services\OrderPaymentHistory::display($createdOrder)==='尚未选择','Quote metadata is not displayed as an unknown issued payment');
 $replacement=$selection+['replace_trade_no'=>$created];
 $replacementQuote=json_decode($actions->quote($requestFor($replacement))->getContent(),true)['data'];
 $assert($replacementQuote['balance_amount']===200 && $replacementQuote['discount_amount']===100 && $createdOrder->fresh()->status===0 && $quoteUser->fresh()->balance===0,'Replacement preview simulates refundable balance and owned coupon without cancellation');
 $methodKey=(string)Str::uuid();$payRequest=Illuminate\Http\Request::create('/api/v10/me/orders/'.$created.'/payments','POST',['trade_no'=>$created,'method'=>$channel->id,'payment_request_key'=>$methodKey,'expected_payment_amount'=>720,'expected_payment_currency'=>'CNY']);$payRequest->user=['id'=>$quoteUser->id];
 $calls=0;$provider=function()use(&$calls){$calls++;return response(['type'=>0,'data'=>'https://pay.example.test/synthetic']);};
 $first=App\Services\CheckoutPayment::once($payRequest,$provider);
 $second=App\Services\CheckoutPayment::once($payRequest,$provider);
 $assert($calls===1 && json_decode($first->getContent(),true)==json_decode($second->getContent(),true),'Payment retry replays result without second provider call');

 $uncertainRequest=clone $payRequest;$uncertainRequest->merge(['payment_request_key'=>(string)Str::uuid()]);
 $unknownCalls=0;
 try {App\Services\CheckoutPayment::once($uncertainRequest,function()use(&$unknownCalls,$uncertainRequest){$unknownCalls++;$uncertainRequest->attributes->set('checkout.provider_started',true);throw new RuntimeException('Synthetic connection loss');});} catch (RuntimeException $e) {}
 $pending=App\Services\CheckoutPayment::once($uncertainRequest,function()use(&$unknownCalls){$unknownCalls++;return response(['type'=>0,'data'=>'unexpected']);});
 $assert($unknownCalls===1 && json_decode($pending->getContent(),true)['type']===2,'Uncertain provider result resumes status checks without reissuing payment');

 $withoutKey=clone $payRequest; $withoutKey->request->remove('payment_request_key');
 try {$actions->checkout($withoutKey);throw new RuntimeException('Missing-key retry bypassed in-flight guard');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Omitting request key cannot bypass an uncertain payment');}
 $payRequest->merge(['method'=>$channel->id+1]);
 try {App\Services\CheckoutPayment::once($payRequest,$provider);throw new RuntimeException('Different payment method accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Payment request key is bound to channel and expected quote');}

 $pendingOrder=Order::create(['user_id'=>$quoteUser->id,'plan_id'=>$plan->id,'trade_no'=>'pending-'.Str::random(16),'period'=>'month_price','currency'=>'CNY','total_amount'=>1000,'type'=>1]);
 $pendingRequest=clone $payRequest;$pendingRequest->merge(['trade_no'=>$pendingOrder->trade_no,'method'=>$channel->id,'payment_request_key'=>(string)Str::uuid()]);
 App\Services\CheckoutPayment::once($pendingRequest,fn()=>response(['type'=>2,'data'=>true]));
 $pendingRequest->merge(['payment_request_key'=>(string)Str::uuid()]);
 try {App\Services\CheckoutPayment::once($pendingRequest,fn()=>response(['type'=>2,'data'=>true]));throw new RuntimeException('New key bypassed pending provider result');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Provider pending result blocks another payment attempt with a fresh key');}
 echo "Order replacement: $checks checks passed\n";
} finally { DB::rollBack(); }

