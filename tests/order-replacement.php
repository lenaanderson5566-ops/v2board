<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
require __DIR__.'/fixtures/V10TestPayment.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Models\Payment;
use App\Payments\V10TestPayment;
use App\Services\Actions\Guest\PaymentActions;
use App\Services\PaymentAttemptHistory;
use App\Services\OrderService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Http\Requests\User\OrderSave;
use App\Services\Actions\User\OrderActions as OrderController;
use Symfony\Component\HttpKernel\Exception\HttpException;
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
 $issuedChannel = Payment::create(['name'=>'Previously issued channel','payment'=>'V10TestPayment','uuid'=>Str::random(8),'enable'=>1,'config'=>[]]);
 $next->payment_id=$issuedChannel->id; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Issued payment replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Issued payment protected'); }
 $next->payment_id=null; $next->status=1; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Paid order replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Paid order protected'); }

 // Unified checkout quotes are pure reads, and order/payment retries are durable.
 $quoteUser = User::create(['email'=>Str::uuid().'@example.com','password'=>'test','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>200,'transfer_enable'=>0,'expired_at'=>0]);
 $channel = Payment::create(['name'=>'Quote test','payment'=>'V10TestPayment','uuid'=>Str::random(8),'enable'=>1,'currency'=>'CNY','handling_fee_percent'=>0,'handling_fee_fixed'=>20,'config'=>['key'=>'must-not-be-public']]);
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
 $otherChannel = Payment::create(['name'=>'Other checkout channel','payment'=>'V10TestPayment','uuid'=>Str::random(8),
     'enable'=>1,'handling_fee_fixed'=>25,'config'=>[]]);
 $makeOrder = fn () => Order::create([
     'user_id'=>$quoteUser->id,'plan_id'=>$plan->id,'trade_no'=>Helper::generateOrderNo(),
     'period'=>'month_price','currency'=>'CNY','total_amount'=>1000,'type'=>1,
 ]);
 $makePayment = function (Order $order, Payment $method, array $overrides = []) {
     $request = Request::create('/api/v10/me/orders/'.$order->trade_no.'/payments', 'POST', $overrides + [
         'trade_no'=>$order->trade_no, 'method'=>$method->id, 'payment_request_key'=>(string) Str::uuid(),
     ]);
     $request->user = ['id'=>$order->user_id];
     return $request;
 };
 $checkout = function (Request $request) use ($actions): array {
     app()->instance('request', $request);
     $result = json_decode($actions->checkout($request)->getContent(), true, flags: JSON_THROW_ON_ERROR);
     ksort($result);
     return $result;
 };
 $checkoutProblem = function (Request $request) use ($actions): array {
     app()->instance('request', $request);
     $response = app(App\Http\Middleware\V10::class)->handle($request, fn (Request $r) => $actions->checkout($r));
     return [$response->getStatusCode(), $response->getData(true)];
 };
 $assertConflict = function (Request $request, string $message, string $code = 'CONFLICT') use ($checkoutProblem, $assert): void {
     [$status, $problem] = $checkoutProblem($request);
     $assert($status === 409 && $problem['code'] === $code, $message);
 };
 $assertLegacyConflict = function (Request $request) use ($checkout, $assert): void {
     try {
         $checkout($request);
     } catch (HttpException $error) {
         $assert($error->getStatusCode() === 409, 'Non-V10 checkout retains its plain HTTP conflict');
         return;
     }
     throw new RuntimeException('Non-V10 checkout bypassed an in-flight payment');
 };

 $quoteFields = ['expected_payment_amount'=>720,'expected_payment_currency'=>'CNY'];
 $payRequest = $makePayment($createdOrder, $channel, $quoteFields);
 $competingRequest = $makePayment($createdOrder, $channel, $quoteFields);
 $earlySwitch = $makePayment($createdOrder, $otherChannel, ['switch_from_payment_method'=>$channel->id]);
 $earlyResume = $makePayment($createdOrder, $channel, ['resume_payment'=>true]);
 $legacySwitch = Request::create('/legacy/order/checkout', 'POST', $earlySwitch->all());
 $legacySwitch->user = $earlySwitch->user;
 $qrAction = ['data'=>'weixin://wxpay/bizpayurl?pr=fixture', 'type'=>0];
 $redirectAction = ['data'=>'https://pay.example.test/new-channel', 'type'=>1];
 $pendingAction = ['data'=>true, 'type'=>2];
 $calls = 0;
 V10TestPayment::$payHandler = function () use (&$calls, $checkout, $payRequest, $assertConflict, $assertLegacyConflict,
     $competingRequest, $earlySwitch, $earlyResume, $legacySwitch, $qrAction, $pendingAction, $assert) {
     if (++$calls !== 1) throw new RuntimeException('Duplicate provider call during initial checkout');
     // Insert another request while the real checkout action is waiting on the provider.
     $assert($checkout(clone $payRequest) === $pendingAction, 'An in-flight original key only reports pending');
     $assertConflict($competingRequest, 'Fresh key is rejected while the same channel is sending', 'PAYMENT_CONFIRMATION_PENDING');
     $assertConflict($earlySwitch, 'A different channel cannot supersede a live provider request', 'PAYMENT_CONFIRMATION_PENDING');
     $assertConflict($earlyResume, 'Read-only resume reports a live provider request', 'PAYMENT_CONFIRMATION_PENDING');
     $assertLegacyConflict($legacySwitch);
     return $qrAction;
 };
 $first = $checkout($payRequest);
 $assert($first === $qrAction && $createdOrder->fresh()->payment_id === $channel->id, 'First request binds the channel and returns its QR');
 $assert($checkout($payRequest) === $first && $checkout($competingRequest) === $first && $calls === 1,
     'Same key and fresh key both replay the issued QR without a second provider call');
 $assertConflict($makePayment($createdOrder, $channel, ['expected_payment_amount'=>721,'expected_payment_currency'=>'CNY']),
     'Fresh key cannot replay the action for a different quoted amount');
 $assertConflict($makePayment($createdOrder, $channel, ['expected_payment_amount'=>720,'expected_payment_currency'=>'USD']),
     'Fresh key cannot replay the action for a different quoted currency');
 $resumeRequest = $makePayment($createdOrder, $channel, ['resume_payment'=>true]);
 $assert($checkout($resumeRequest) === $first && $calls === 1, 'Explicit resume restores the issued QR without calling the gateway');
 $existing = $createdOrder->fresh();
 $snapshot = $existing->payment_snapshot;
 $failedHistory = $snapshot;
 $failedHistory['payment_attempts'][(string) Str::uuid()] = [
     'method' => $channel->id, 'state' => 'started', 'provider_failed' => true,
 ];
 $existing->update(['payment_snapshot'=>$failedHistory]);
 $assert($checkout($resumeRequest) === $first && $calls === 1,
     'A recorded failure does not prevent reading the current issued QR');
 $existing->update(['payment_snapshot'=>$snapshot]);
 $assertConflict($makePayment($createdOrder, $otherChannel), 'Changing channels without explicit confirmation is rejected even after a QR was issued');
 $assertConflict($makePayment($createdOrder, $otherChannel, ['switch_from_payment_method'=>$issuedChannel->id]),
     'Switch confirmation must name the currently selected channel');
 $reusedKey = $makePayment($createdOrder, $otherChannel, ['payment_request_key'=>$payRequest->input('payment_request_key')]);
 $assertConflict($reusedKey, 'An old request key remains bound to its original channel and quote');

 V10TestPayment::$payHandler = function () use (&$calls, $redirectAction) {
     ++$calls;
     return $redirectAction;
 };
 $switchRequest = $makePayment($createdOrder, $otherChannel, ['switch_from_payment_method'=>$channel->id]);
 $assert($checkout($switchRequest) === $redirectAction && $checkout($switchRequest) === $redirectAction
     && $createdOrder->fresh()->payment_id === $otherChannel->id && $calls === 2, 'An explicit switch calls the new channel once');
 $assert($checkout($makePayment($createdOrder, $otherChannel)) === $redirectAction && $calls === 2,
     'A fresh key also replays the current redirect without contacting the gateway');
 $assertConflict($resumeRequest, 'Explicit resume cannot restore a superseded channel');
 $assertConflict($payRequest, 'The original request key cannot replay a superseded channel');

 $existing = $createdOrder->fresh();
 $snapshot = $existing->payment_snapshot;
 unset($snapshot['payment_action_key']);
 $existing->update(['payment_snapshot'=>$snapshot]);
 $assert($checkout($makePayment($createdOrder, $otherChannel, ['resume_payment'=>true])) === $redirectAction
     && $checkout($makePayment($createdOrder, $otherChannel)) === $redirectAction && $calls === 2,
     'Legacy snapshots without an action key recover the sole current action while ignoring the older channel');
 $ambiguous = $snapshot;
 $ambiguous['payment_attempts'][(string) Str::uuid()] = $snapshot['payment_attempts'][$switchRequest->input('payment_request_key')];
 $existing->update(['payment_snapshot'=>$ambiguous]);
 $assertConflict($makePayment($createdOrder, $otherChannel), 'Legacy replay rejects multiple possible actions on the same channel');
 $assertConflict($makePayment($createdOrder, $otherChannel, ['resume_payment'=>true]),
     'Read-only resume distinguishes an ambiguous saved action', 'PAYMENT_ACTION_UNAVAILABLE');
 unset($snapshot['channels'][$otherChannel->id]['payment_amount']);
 $existing->update(['payment_snapshot'=>$snapshot]);
 $otherChannel->update(['handling_fee_fixed'=>50]);
 $assert($checkout($makePayment($createdOrder, $otherChannel, ['expected_payment_amount'=>725,'expected_payment_currency'=>'CNY'])) === $redirectAction,
     'Legacy replay uses the fee saved on the order, even after the live fee changes');
 $assertConflict($makePayment($createdOrder, $otherChannel, ['expected_payment_amount'=>750,'expected_payment_currency'=>'CNY']),
     'Changing the configured fee does not alter the saved legacy quote');
 $assertConflict($payRequest, 'A legacy snapshot cannot replay a superseded channel request');
 $assertConflict($makePayment($createdOrder, $channel), 'A fresh key cannot expose a superseded channel from a legacy snapshot');
 $assert($calls === 2, 'Rejected and replayed requests leave the provider call count unchanged');

 $uncertainOrder = $makeOrder();
 $uncertainRequest = $makePayment($uncertainOrder, $channel);
 $uncertainId = Str::uuid()->toString();
 $uncertainRequest->attributes->set('requestId', $uncertainId);
 $unknownCalls = 0;
 V10TestPayment::$payHandler = function (array $order, PaymentAttemptHistory $diagnostic) use (&$unknownCalls) {
     ++$unknownCalls;
     $diagnostic->sending('https://pay.example.test/mapi.php?sign=fixture-secret');
     $diagnostic->received((object)['curlErrorCode'=>28], 'fixture-secret', null, null);
     throw new RuntimeException('Synthetic connection loss');
 };
 try {
     $checkout($uncertainRequest);
     throw new RuntimeException('Synthetic timeout was not propagated');
 } catch (RuntimeException $error) {
     $assert($error->getMessage() === 'Synthetic connection loss', 'Provider timeout is propagated without creating a payment action');
 }
 $assert($checkout($uncertainRequest) === $pendingAction && $unknownCalls === 1,
     'Uncertain provider result resumes status checks without reissuing payment');
 $withoutKey = $makePayment($uncertainOrder, $channel);
 $withoutKey->request->remove('payment_request_key');
 $assertConflict($withoutKey, 'Omitting a key cannot bypass an uncertain payment', 'PAYMENT_CONFIRMATION_PENDING');
 $diagnostics = PaymentAttemptHistory::forOrder($uncertainOrder)['events'];
 $blocked = $diagnostics->first();
 $timeout = $diagnostics->firstWhere('request_id', $uncertainId);
 $assert($blocked->result === 'blocked' && $blocked->previous_request_id === $uncertainId
     && $timeout?->stage === 'gateway' && $timeout?->reason === 'gateway_timeout', 'Retry links to the original gateway timeout');
 $assert($timeout->gateway_host === 'pay.example.test' && $timeout->gateway_code === null
     && !str_contains($diagnostics->toJson(), 'fixture-secret'), 'Diagnostics retain the host and omit secrets and raw gateway values');
 $channelFailureBaseline = (int) (PaymentAttemptHistory::recentFailures()[$channel->id] ?? 0);
 $unavailableResume = $makePayment($uncertainOrder, $channel, ['resume_payment'=>true]);
 $assertConflict($unavailableResume, 'A recorded gateway timeout has no action to resume', 'PAYMENT_ACTION_UNAVAILABLE');
 $unavailableId = $unavailableResume->attributes->get('requestId');
 $unavailableEvent = PaymentAttemptHistory::forOrder($uncertainOrder)['events']->firstWhere('request_id', $unavailableId);
 $assert($unavailableEvent?->stage === 'preflight' && $unavailableEvent->reason === 'saved_payment_action_unavailable',
     'A missing saved action is distinct from a missing payment action in a gateway response');
 $assert($unknownCalls === 1, 'A missing saved action does not create another provider request');

 $diagnosticFixture = [
     'order_id' => $uncertainOrder->id, 'payment_id' => $channel->id, 'provider' => $channel->payment, 'result' => 'failed',
 ];
 $gatewayMissingId = DB::table(PaymentAttemptHistory::TABLE)->insertGetId($diagnosticFixture + [
     'stage' => 'gateway', 'reason' => 'missing_payment_action', 'created_at' => $unavailableEvent->created_at,
 ]);
 $misses = [];
 for ($i = 0; $i < 24; $i++) {
     $misses[] = $diagnosticFixture + [
         'stage' => 'preflight',
         'reason' => $i % 2 === 0 ? 'missing_payment_action' : 'saved_payment_action_unavailable',
         'request_id' => Str::uuid()->toString(),
         'created_at' => $unavailableEvent->created_at + ($i === 22 ? 1 : 0),
     ];
 }
 DB::table(PaymentAttemptHistory::TABLE)->insert($misses);
 $diagnostics = PaymentAttemptHistory::forOrder($uncertainOrder)['events'];
 $groupedRecovery = $diagnostics->whereNotNull('recovery_miss_count');
 $assert($groupedRecovery->count() === 1 && $groupedRecovery->first()->recovery_miss_count === 25
     && $groupedRecovery->first()->request_id === $misses[22]['request_id']
     && $diagnostics->firstWhere('request_id', $uncertainId)?->reason === 'gateway_timeout'
     && $diagnostics->firstWhere('id', $gatewayMissingId)?->stage === 'gateway',
     'Repeated local checks keep their latest row and count while retaining the original gateway diagnostics');
 $channelFailures = PaymentAttemptHistory::forChannel($channel->id)['events'];
 $assert((int) PaymentAttemptHistory::recentFailures()[$channel->id] === $channelFailureBaseline + 1
     && $channelFailures->firstWhere('id', $gatewayMissingId)?->stage === 'gateway'
     && $channelFailures->firstWhere('request_id', $uncertainId)?->stage === 'gateway'
     && !$channelFailures->contains(fn ($event) => $event->stage === 'preflight'
         && in_array($event->reason, ['missing_payment_action', 'saved_payment_action_unavailable'], true)),
     'Channel failure lists and counts ignore local checks and keep missing actions reported by the gateway');

 $existing = $uncertainOrder->fresh();
 $snapshot = $existing->payment_snapshot;
 unset($snapshot['payment_attempts'][$uncertainRequest->input('payment_request_key')]['provider_failed']);
 $existing->update(['payment_snapshot'=>$snapshot]);
 $assertConflict($makePayment($uncertainOrder, $channel, ['resume_payment'=>true]),
     'Legacy gateway diagnostics also distinguish a recorded failure from a live request', 'PAYMENT_ACTION_UNAVAILABLE');
 V10TestPayment::$payHandler = function () use (&$unknownCalls, $redirectAction) {
     ++$unknownCalls;
     return $redirectAction;
 };
 $afterTimeout = $makePayment($uncertainOrder, $otherChannel, ['switch_from_payment_method'=>$channel->id]);
 $assert($checkout($afterTimeout) === $redirectAction && $checkout($afterTimeout) === $redirectAction && $unknownCalls === 2,
     'Explicit switch after a recorded legacy provider failure is issued once');

 $pendingOrder = $makeOrder();
 $pendingCalls = 0;
 V10TestPayment::$payHandler = function () use (&$pendingCalls, $pendingAction) {
     ++$pendingCalls;
     return $pendingAction;
 };
 $assert($checkout($makePayment($pendingOrder, $channel)) === $pendingAction, 'Provider pending result is returned');
 $assertConflict($makePayment($pendingOrder, $channel), 'A fresh key cannot bypass a provider pending result', 'PAYMENT_CONFIRMATION_PENDING');
 $assertConflict($makePayment($pendingOrder, $channel, ['resume_payment'=>true]),
     'A provider pending result still blocks read-only resume', 'PAYMENT_CONFIRMATION_PENDING');
 $assertConflict($makePayment($pendingOrder, $otherChannel, ['switch_from_payment_method'=>$channel->id]),
     'An explicit switch cannot bypass a provider pending result', 'PAYMENT_CONFIRMATION_PENDING');
 $assert($pendingCalls === 1, 'Pending payment blocks every additional provider call');

 $raceOrder = $makeOrder();
 V10TestPayment::$payHandler = fn () => $qrAction;
 $checkout($makePayment($raceOrder, $channel));
 V10TestPayment::$payHandler = function () use ($raceOrder, $channel, $redirectAction, $assert) {
     $callback = Request::create('/api/v10/webhooks/payments/V10TestPayment/'.$channel->uuid, 'POST', [
         'signature'=>'local-test-signature','orderNumber'=>$raceOrder->trade_no,'amount'=>1020,'currency'=>'CNY',
     ]);
     $result = (new PaymentActions())->notify($channel->payment, $channel->uuid, $callback);
     $assert($result === 'success', 'Original signed callback can settle while the new provider is sending');
     return $redirectAction;
 };
 $paidWhileSwitching = $checkout($makePayment($raceOrder, $otherChannel, ['switch_from_payment_method'=>$channel->id]));
 $assert($paidWhileSwitching === $pendingAction && $raceOrder->fresh()->callback_no === 'local-callback'
     && $raceOrder->fresh()->payment_id === $channel->id, 'Old channel settlement suppresses the new payment link');
 V10TestPayment::$payHandler = null;

 $epay=App\Models\Payment::create(['name'=>'WeChat fixture','payment'=>'EPayQrcode','uuid'=>App\Utils\Helper::guid(),
     'enable'=>1,'config'=>['pid'=>'fixture','key'=>'fixture','url'=>'https://pay.example.test']]);
 $epayOrder=Order::create(['user_id'=>$quoteUser->id,'plan_id'=>$plan->id,'trade_no'=>'epay-'.Str::random(16),
     'period'=>'month_price','currency'=>'CNY','total_amount'=>1000,'type'=>1]);
 foreach ([null, 'ftp://pay.example.test'] as $badUrl) {
     if ($badUrl !== null) $epay->update(['config'=>['pid'=>'fixture','key'=>'fixture','type'=>'wxpay','url'=>$badUrl]]);
     $attempt=Illuminate\Http\Request::create('/api/v10/me/orders/'.$epayOrder->trade_no.'/payments','POST',[
         'trade_no'=>$epayOrder->trade_no,'method'=>$epay->id,'payment_request_key'=>Str::uuid()->toString(),
     ]);
     $attempt->user=['id'=>$quoteUser->id];
     [$status, $problem] = $checkoutProblem($attempt);
     $fresh = $epayOrder->fresh();
     $assert($status === 422 && $problem['code'] === 'PAYMENT_CHANNEL_UNAVAILABLE'
         && (int) $fresh->payment_id === 0 && empty($fresh->payment_snapshot['payment_attempts'])
         && empty($fresh->payment_snapshot['channels']),
         'Local EPay configuration failure leaves the order free to select another channel');
 }

 $mgate = App\Models\Payment::create(['name'=>'MGate fixture','payment'=>'MGate','uuid'=>App\Utils\Helper::guid(),
     'enable'=>1,'config'=>['mgate_url'=>'https://pay.example.test','mgate_source_currency'=>'CNY']]);
 $mgateRequest = clone $attempt;
 $mgateRequest->merge(['method'=>$mgate->id]);
 for ($i = 0; $i < 2; $i++) {
     $mgateRequest->merge(['payment_request_key'=>Str::uuid()->toString()]);
     [$status, $problem] = $checkoutProblem($mgateRequest);
     $fresh = $epayOrder->fresh();
     $assert($status === 422 && $problem['code'] === 'PAYMENT_CHANNEL_UNAVAILABLE'
         && (int) $fresh->payment_id === 0 && empty($fresh->payment_snapshot['payment_attempts']),
         'MGate preflight configuration failure receives a known local rejection');
 }
 $mgateFailures = App\Services\PaymentAttemptHistory::forChannel($mgate->id)['events'];
 $assert($mgateFailures->count() === 2 && $mgateFailures->every(fn ($event) =>
     $event->stage === 'preflight' && $event->reason === 'missing_credentials' && $event->trade_no === $epayOrder->trade_no)
     && App\Services\PaymentAttemptHistory::recentFailures()[$mgate->id] == 2,
     'Channel diagnostics count failures and link to the relevant order');

 $adapter = new App\Payments\EPayQrcode(['type'=>'wxpay']);
 $gatewayResponse = new ReflectionMethod($adapter, 'gatewayResponse');
 $rejectedOrder = $makeOrder();
 $rejectedRequest = $makePayment($rejectedOrder, $channel);
 $rejectedCalls = 0;
 V10TestPayment::$payHandler = function (array $order, PaymentAttemptHistory $diagnostic) use (&$rejectedCalls, $adapter, $gatewayResponse) {
     ++$rejectedCalls;
     $diagnostic->sending('https://pay.example.test/mapi.php');
     $gatewayResponse->invoke($adapter, (object) [
         'response' => '{"status":"error","msg":"sensitive fixture gateway text"}',
         'httpStatusCode' => 200,
         'error' => false,
     ], $diagnostic);
     throw new RuntimeException('EPay unexpectedly accepted a gateway rejection');
 };
 [$status, $problem] = $checkoutProblem($rejectedRequest);
 $assert($status === 500 && $problem['code'] === 'PAYMENT_GATEWAY_REJECTED'
     && !str_contains($problem['detail'], 'sensitive fixture gateway text'),
     'Provider rejection has a specific code with redacted detail');
 $assert($checkout($rejectedRequest) === $pendingAction && $rejectedCalls === 1,
     'Provider rejection does not allow the original request key to contact the gateway again');
 V10TestPayment::$payHandler = null;

 foreach ([
     ['{"status":"error","msg":"temporary error"}', 502, true],
     ['{"status":"error","msg":" "}', 200, false],
     ['<html>Service unavailable</html>', 200, false],
 ] as [$body, $httpStatus, $transportError]) {
     $diagnostic = new PaymentAttemptHistory(null);
     $diagnostic->sending('https://pay.example.test/mapi.php');
     try {
         $gatewayResponse->invoke($adapter, (object) [
             'response' => $body, 'httpStatusCode' => $httpStatus, 'error' => $transportError,
         ], $diagnostic);
         throw new RuntimeException('EPay unexpectedly accepted an invalid gateway response');
     } catch (HttpException $error) {
         $assert($error->getStatusCode() === 500 && !$diagnostic->gatewayRejected(),
             'A transport or unrecognized response error remains uncertain');
     }
 }
 $action=new ReflectionMethod($adapter, 'paymentAction');
 $qr='weixin://wxpay/bizpayurl?pr=test';
 $success = $gatewayResponse->invoke($adapter, (object) [
     'response' => (object) ['code' => 1, 'qrcode' => $qr], 'httpStatusCode' => 200, 'error' => false,
 ], null);
 $assert($success->qrcode === $qr, 'EPay preserves the code=1 success contract');
 $wallet='weixin://wap/pay?prepayid=test';
 $h5='https://pay.example.test/wx';
 $previousUa=$_SERVER['HTTP_USER_AGENT'] ?? null;
 try {
     $_SERVER['HTTP_USER_AGENT']='Mobile iPhone';
     $assert($action->invoke($adapter,(object)['qrcode'=>$qr,'urlscheme'=>$wallet,'payurl'=>$h5])===['type'=>1,'data'=>$wallet], 'Mobile WeChat opens a launchable wallet URL');
     $assert($action->invoke($adapter,(object)['qrcode'=>$qr,'urlscheme'=>$qr,'payurl'=>$h5])===['type'=>1,'data'=>$h5], 'Mobile WeChat prefers H5 to scan-only data');
     $assert($action->invoke($adapter,(object)['qrcode'=>$qr])===['type'=>0,'data'=>$qr], 'Mobile WeChat can still display a scan-only QR');
     $_SERVER['HTTP_USER_AGENT']='Desktop';
     $assert($action->invoke($adapter,(object)['qrcode'=>$qr,'urlscheme'=>$wallet,'payurl'=>$h5])===['type'=>0,'data'=>$qr], 'Desktop WeChat still prefers the QR');
 } finally {
     if ($previousUa === null) unset($_SERVER['HTTP_USER_AGENT']);
     else $_SERVER['HTTP_USER_AGENT']=$previousUa;
 }
 echo "Order replacement: $checks checks passed\n";
} finally { DB::rollBack(); }

