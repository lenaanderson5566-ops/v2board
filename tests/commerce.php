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
    config(['v2board.new_user_currency'=>'CNY','v2board.telegram_bot_enable'=>0,'v2board.deposit_bounus'=>['100:10'],'v2board.invite_commission'=>10,'v2board.commission_distribution_enable'=>0,'v2board.withdraw_close_enable'=>0]);
    $user=User::create(['email'=>'legacy-'.uniqid().'@example.test','password'=>'test','token'=>bin2hex(random_bytes(16)),'uuid'=>Illuminate\Support\Str::uuid(),'balance'=>5000,'transfer_enable'=>0,'expired_at'=>0]);
    $plan=Plan::create(['name'=>'Dual currency fixture','group_id'=>1,'transfer_enable'=>100,'month_price'=>3000,'year_price'=>30000,'show'=>1,'renew'=>1,'usd_prices'=>['month_price'=>500,'year_price'=>5000]]);
    config(['v2board.new_user_currency'=>'USD','v2board.currency'=>'USD']);
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
    [$r]=$call('me/coupon-claims',['couponId'=>-1],$auth);$assert($r->getStatusCode()===422,'Invalid coupon id accepted');

    DB::table('v2_exchange_rate')->where('id',1)->update(['quoted_at'=>time(),'usd_cny_micros'=>8000000]);
    $user->refresh();$user->commission_type=1;$user->save();$usd->refresh();$usd->invite_user_id=$user->id;$usd->save();
    $commissionOrder=new Order(['user_id'=>$usd->id,'currency'=>'USD','plan_id'=>$plan->id,'type'=>1,'period'=>'month_price','trade_no'=>'commission-'.uniqid(),'total_amount'=>500,'status'=>3]);
    (new OrderService($commissionOrder))->setInvite($usd);$commissionOrder->save();
    $assert((int)$commissionOrder->commission_balance===50 && $commissionOrder->fx_snapshot['usdCnyMicros']===8000000,'Cross-currency commission snapshot');
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
    (new App\Console\Commands\CheckRenewal)->handle();
    $assert($user->fresh()->balance===3000 && $user->fresh()->currency==='CNY','Automatic renewal changed original CNY price');
    $assert($user->fresh()->expired_at>time()+25*86400,'Automatic renewal did not extend service');
    (new App\Console\Commands\CheckRenewal)->handle();$assert($user->fresh()->balance===3000,'Automatic renewal repeated debit');

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
