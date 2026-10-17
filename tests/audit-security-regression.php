<?php
$app = require __DIR__.'/support/bootstrap.php';
if(!app()->environment('local'))throw new RuntimeException('Local only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,get_class($e).': '.$e->getMessage());exit(1);});
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
DB::beginTransaction(); $auth=null; $userAuth=null; \Illuminate\Support\Facades\Queue::fake();
$checks=0; $assert = \Tests\Support\Assertions::counter($checks);
try {
 $make=function($role){return User::create(['email'=>'audit-'.bin2hex(random_bytes(5)).'@example.com','password'=>password_hash('Original-test-123',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>$role==='admin'?1:0,'is_staff'=>$role==='staff'?1:0]);};
 $staff=$make('staff');$admin=$make('admin');$user=$make('user');
 $auth=new App\Services\AuthService($staff);$token=$auth->generateAuthData(Request::create('/'))['auth_data'];
 $kernel=app(Illuminate\Contracts\Http\Kernel::class);
 $call=function($path,$method,$data)use($kernel,$token){$r=Request::create($path,$method,$data,[],[],['HTTP_AUTHORIZATION'=>$token,'HTTP_ACCEPT'=>'application/json']);return $kernel->handle($r);};
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$admin->id,'email'=>$admin->email,'password'=>'Changed-test-123','banned'=>0]);
 $assert($r->getStatusCode()===404 && password_verify('Original-test-123',$admin->fresh()->password),'Staff cannot reset admin password');
 $r=$call('/api/v1/staff/user/getUserInfoById','GET',['id'=>$user->id]);$data=json_decode($r->getContent(),true)['data']??[];
 $assert($r->getStatusCode()===200 && !array_intersect(['password','token','uuid','password_salt'],array_keys($data)),'No credentials in staff response');
 $filter=[['key'=>'id','condition'=>'=','value'=>$user->id]];
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>$filter]);
 $assert($r->getStatusCode()===200 && $user->fresh()->banned===1,'Filtered ban works');
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>[['key'=>'id','condition'=>'=','value'=>$admin->id]]]);
 $assert($r->getStatusCode()===200 && !$admin->fresh()->banned,'Batch ban excludes administrators');
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>[['key'=>'password','condition'=>'=','value'=>'x']]]);
 $assert($r->getStatusCode()===422,'Sensitive filter rejected');
 $r=$call('/api/v1/staff/user/sendMail','POST',['filter'=>$filter,'subject'=>'Audit fixture','content'=>'Fixture','purpose'=>'service','request_key'=>(string)Illuminate\Support\Str::uuid()]);
 $assert($r->getStatusCode()===200,'Mail filter works');
 \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\SendEmailJob::class,1);
 $r=$call('/api/v1/staff/user/sendMail','POST',['filter'=>[['key'=>'id','condition'=>'=','value'=>$admin->id]],'subject'=>'Audit fixture','content'=>'Fixture']);
 \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\SendEmailJob::class,1);
 $userAuth=new App\Services\AuthService($user);$userToken=$userAuth->generateAuthData(Request::create('/'))['auth_data'];
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$user->id,'email'=>$user->email,'password'=>'Changed-test-123','banned'=>0]);
 $assert($r->getStatusCode()===200 && password_verify('Changed-test-123',$user->fresh()->password),'Normal user update remains available');
 $assert(!App\Services\AuthService::decryptAuthData($userToken),'Password change revokes previous sessions');
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$staff->id,'email'=>$staff->email,'password'=>'Changed-test-123','banned'=>0]);
 $assert($r->getStatusCode()===404,'Staff cannot edit staff accounts');
 $epay=new App\Payments\EPay(['key'=>'local-fixture-key']);
 $p=['money'=>'0.01','out_trade_no'=>'test-order','trade_no'=>'fixture','trade_status'=>'TRADE_SUCCESS'];ksort($p);$p['sign']=md5(stripslashes(urldecode(http_build_query($p))).'local-fixture-key');$p['sign_type']='MD5';
 $v=$epay->notify($p);$assert($v['amount']===1 && $v['currency']==='CNY','Verified amount retained');
 foreach (['-1','1.001','1e2',null,[]] as $invalid) {
  try { App\Services\Money::parseMinor($invalid); throw new RuntimeException('Accepted malformed amount'); }
  catch (InvalidArgumentException $e) {$checks++;}
 }
 $payment=App\Models\Payment::create(['name'=>'Audit EPay','payment'=>'EPay','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['key'=>'local-fixture-key']]);
 $other=App\Models\Payment::create(['name'=>'Other EPay','payment'=>'EPay','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['key'=>'local-fixture-key']]);
 $order=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'handling_amount'=>10,'payment_id'=>$payment->id,'status'=>0]);
 $notify=function($money,$channel,$status='TRADE_SUCCESS')use($order){
  $p=['money'=>$money,'out_trade_no'=>$order->trade_no,'trade_no'=>'fixture','trade_status'=>$status];ksort($p);
  $p['sign']=md5(stripslashes(urldecode(http_build_query($p))).'local-fixture-key');$p['sign_type']='MD5';
  return (new App\Services\Actions\Guest\PaymentActions())->notify('EPay',$channel->uuid,Request::create('/','POST',$p));
 };
 foreach ([['0.01',$payment],['10.10',$other],['10.10',$payment,'WAIT_BUYER_PAY']] as $args) {
  try {$notify(...$args);throw new RuntimeException('Invalid settlement accepted');}
  catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($order->fresh()->status===0,'Rejected callback leaves order pending');}
 }
 $assert($notify('10.10',$payment)==='success' && $order->fresh()->status===1,'Exact signed amount including fee settles');
 $assert($notify('10.10',$payment)==='success','Duplicate callback acknowledged');
 $stripe=App\Models\Payment::create(['name'=>'Audit Stripe','payment'=>'StripeCheckout','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['stripe_sk_live'=>'sk_test_fixture','stripe_webhook_key'=>'whsec_fixture','currency'=>'cny']]);
 $stripeOrder=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'payment_id'=>$stripe->id,'status'=>0]);
 $stripeNotify=function($currency,$amount,$type='checkout.session.completed',$paid='paid',$valid=true)use($stripe,$stripeOrder,$app){
  $payload=json_encode(['id'=>'evt_fixture','object'=>'event','type'=>$type,'data'=>['object'=>['object'=>'checkout.session','client_reference_id'=>$stripeOrder->trade_no,'payment_intent'=>'pi_fixture','payment_status'=>$paid,'amount_total'=>$amount,'currency'=>$currency]]]);
  $timestamp=time();$signature=hash_hmac('sha256',$timestamp.'.'.$payload,$valid?'whsec_fixture':'wrong');
  $request=Request::create('/','POST',[],[],[],['HTTP_STRIPE_SIGNATURE'=>"t=$timestamp,v1=$signature"],$payload);
  $previous=$app->make('request');$app->instance('request',$request);
  try {return (new App\Services\Actions\Guest\PaymentActions())->notify('StripeCheckout',$stripe->uuid,$request);}
  finally {$app->instance('request',$previous);}
 };
 foreach ([['usd',1000],['cny',1],['cny',1000,'checkout.session.completed','paid',false]] as $args) {
  try {$stripeNotify(...$args);throw new RuntimeException('Invalid Stripe settlement accepted');}
  catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($stripeOrder->fresh()->status===0,'Stripe mismatch rejected');}
 }
 $assert($stripeNotify('cny',1000,'checkout.session.completed','unpaid')==='success' && $stripeOrder->fresh()->status===0,'Unpaid event acknowledged without settlement');
 $assert($stripeNotify('cny',1000,'checkout.session.expired')==='success' && $stripeOrder->fresh()->status===0,'Unrelated event acknowledged without settlement');
 $assert($stripeNotify('cny',1000)==='success' && $stripeOrder->fresh()->status===1,'Signed Stripe payment settles');
 // Legacy crypto events must be signed and settled before reaching shared settlement.
 $cryptoRequest=function(string $payload,string $header,string $signature) use($app) {
     $r=Request::create('/api/v10/webhooks/payments/test/fixture','POST',[],[],[],[$header=>$signature],$payload);
     $app->instance('request',$r); return $r;
 };
 $coinbase=new App\Payments\Coinbase(['coinbase_webhook_key'=>'crypto-fixture']);
 foreach (['charge:created','charge:pending','charge:failed','charge:resolved','charge:confirmed'] as $type) {
     $payload=" ".json_encode(['event'=>['id'=>'evt-fixture','type'=>$type,'data'=>['metadata'=>['outTradeNo'=>'order-fixture'],'pricing'=>['local'=>['amount'=>'10.10','currency'=>'USD']]]]])."\n";
     $cryptoRequest($payload,'HTTP_X_CC_WEBHOOK_SIGNATURE',hash_hmac('sha256',$payload,'crypto-fixture'));
     $result=$coinbase->notify([]);
     $assert($type==='charge:confirmed' ? $result['amount']===1010 && $result['currency']==='USD' : $result==='success','Coinbase only confirmed events settle: '.$type);
 }
 $cryptoRequest($payload,'HTTP_X_CC_WEBHOOK_SIGNATURE','invalid');
 try {$coinbase->notify([]);throw new RuntimeException('Invalid Coinbase signature accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$checks++;}
 $btcpay=new class(['btcpay_webhook_key'=>'crypto-fixture']) extends App\Payments\BTCPay {
     public array $invoice=['id'=>'invoice-fixture','status'=>'Settled','additionalStatus'=>'None','amount'=>'10.10','currency'=>'CNY','metadata'=>['orderId'=>'order-fixture']];
     protected function fetchInvoice(string $id): array {return $this->invoice;}
 };
 foreach (['InvoiceCreated','InvoiceProcessing','InvoiceExpired','InvoiceSettled'] as $type) {
     $payload=json_encode(['type'=>$type,'invoiceId'=>'invoice-fixture'])."\n";
     $cryptoRequest($payload,'HTTP_BTCPAY_SIG','sha256='.hash_hmac('sha256',$payload,'crypto-fixture'));
     $result=$btcpay->notify([]);
     $assert($type==='InvoiceSettled' ? $result['amount']===1010 && $result['currency']==='CNY' : $result==='success','BTCPay only settled events settle: '.$type);
 }
 foreach ([['Processing','None'],['Settled','PaidPartial'],['Settled','Marked']] as [$state,$extra]) {
     $btcpay->invoice['status']=$state;$btcpay->invoice['additionalStatus']=$extra;
     try {$btcpay->notify([]);throw new RuntimeException('Unsettled invoice accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$checks++;}
 }
 $cp=new App\Payments\CoinPayments(['coinpayments_merchant_id'=>'fixture','coinpayments_ipn_secret'=>'crypto-fixture']);
 $params=['ipn_mode'=>'hmac','merchant'=>'fixture','status'=>'100','item_number'=>'order-fixture','txn_id'=>'tx-fixture','amount1'=>'10.10','currency1'=>'USD'];
 $payload=http_build_query($params);
 $cryptoRequest($payload,'HTTP_HMAC',hash_hmac('sha512',$payload,'crypto-fixture'));
 $result=$cp->notify($params);
 $assert($result['amount']===1010 && $result['currency']==='USD' && $result['custom_result']==='IPN OK','CoinPayments verifies original bytes and retains native success');
 $cryptoRequest($payload.'x','HTTP_HMAC',hash_hmac('sha512',$payload,'crypto-fixture'));
 try {$cp->notify($params);throw new RuntimeException('Tampered IPN accepted');} catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$checks++;}
 $legacyChannel=App\Models\Payment::create(['name'=>'Audit Coinbase','payment'=>'Coinbase','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['coinbase_webhook_key'=>'crypto-fixture']]);
 $legacyOrder=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'payment_id'=>$legacyChannel->id,'status'=>0]);
 foreach ([['0.01','CNY',false],['10.00','USD',false],['10.00','CNY',true],['10.00','CNY',true]] as [$amount,$currency,$accepted]) {
     $payload=json_encode(['event'=>['id'=>'evt-settlement','type'=>'charge:confirmed','data'=>['metadata'=>['outTradeNo'=>$legacyOrder->trade_no],'pricing'=>['local'=>['amount'=>$amount,'currency'=>$currency]]]]]);
     $request=$cryptoRequest($payload,'HTTP_X_CC_WEBHOOK_SIGNATURE',hash_hmac('sha256',$payload,'crypto-fixture'));
     try {
         $result=(new App\Services\Actions\Guest\PaymentActions())->notify('Coinbase',$legacyChannel->uuid,$request);
         $assert($accepted && $result==='success' && $legacyOrder->fresh()->status===1,'Coinbase exact amount settles and repeated callback is idempotent');
     } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {
         $assert(!$accepted && $legacyOrder->fresh()->status===0,'Coinbase amount/currency mismatch leaves order pending');
     }
 }
 $qr=new App\Payments\EPayQrcode(['pid'=>'fixture','key'=>'qr-fixture']);
 $params=['pid'=>'fixture','money'=>'10.10','out_trade_no'=>'order-fixture','trade_no'=>'tx-fixture','trade_status'=>'TRADE_SUCCESS'];
 ksort($params);$pairs=[];foreach($params as $key=>$value)$pairs[]=$key.'='.$value;
 $params['sign']=md5(implode('&',$pairs).'qr-fixture');$params['sign_type']='MD5';
 $result=$qr->notify($params);
 $assert($result['amount']===1010 && $result['currency']==='CNY','EPay QR signed amount reaches shared settlement');
 $params['money']='0.01';
 $assert($qr->notify($params)===false,'EPay QR rejects altered signed amount');
 echo "Audit security regression: $checks checks passed\n";
} finally {if($userAuth)$userAuth->removeAllSession();if($auth)$auth->removeAllSession();DB::rollBack();}
