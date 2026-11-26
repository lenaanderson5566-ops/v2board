<?php
$app = require __DIR__.'/support/bootstrap.php';
if(!app()->environment('local'))throw new RuntimeException('Local only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,get_class($e).': '.$e->getMessage());exit(1);});
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
DB::beginTransaction(); $auth=null; $userAuth=null; $adminAuth=null; \Illuminate\Support\Facades\Queue::fake();
$checks=0; $assert = \Tests\Support\Assertions::counter($checks);
try {
 $make=function($role){return User::create(['email'=>'audit-'.bin2hex(random_bytes(5)).'@example.com','password'=>password_hash('Original-test-123',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>$role==='admin'?1:0]);};
 $restricted=$make('user');$admin=$make('admin');$user=$make('user');
 $auth=new App\Services\AuthService($restricted);$token=$auth->generateAuthData(Request::create('/'))['auth_data'];
 $kernel=app(Illuminate\Contracts\Http\Kernel::class);
 $call=function($path,$method,$data)use($kernel,$token){$r=Request::create($path,$method,$data,[],[],['HTTP_AUTHORIZATION'=>$token,'HTTP_ACCEPT'=>'application/json']);return $kernel->handle($r);};
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$admin->id,'email'=>$admin->email,'password'=>'Changed-test-123','banned'=>0]);
 $assert($r->getStatusCode()===404 && password_verify('Original-test-123',$admin->fresh()->password),'Staff cannot reset admin password');
 $r=$call('/api/v1/staff/user/getUserInfoById','GET',['id'=>$user->id]);$data=json_decode($r->getContent(),true)['data']??[];
 $assert($r->getStatusCode()===404 && !$data,'Retired staff details expose no user data');
 // Administrative account responses must not serialize password material or inviter credentials.
 $user->update(['invite_user_id'=>$admin->id]);
 $adminAuth=new App\Services\AuthService($admin);
 $adminToken=$adminAuth->generateAuthData(Request::create('/'))['auth_data'];
 $adminPath='/api/v1/'.config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
 $as=function($path,$credential,$params=[])use($kernel){return $kernel->handle(Request::create($path,'GET',$params,[],[],['HTTP_AUTHORIZATION'=>$credential,'HTTP_ACCEPT'=>'application/json']));};
 $secrets=['password','password_algo','password_salt','token','uuid','auth_data','is_staff'];
 $assert(!array_intersect(['password','password_algo','password_salt'],array_keys($user->toArray())) && password_verify('Original-test-123',$user->password),'Model serialization hides password material without breaking verification');
 $r=$as($adminPath.'/user/fetch',$adminToken,['filter'=>[['key'=>'id','condition'=>'=','value'=>$user->id]]]);
 $listed=json_decode($r->getContent(),true)['data'][0]??[];
 $assert($r->getStatusCode()===200 && ($listed['id']??null)===$user->id,'Administrator user list works');
 $assert(!array_intersect($secrets,array_keys($listed)),'Administrator list omits raw credentials');
 $assert(($listed['uses_legacy_password'] ?? null) === false, 'Current password hashing has no legacy flag');
 $assert(($listed['subscribe_url']??null)===App\Utils\Helper::getSubscribeUrl($user->token),'Authorized administrator subscription-link operation remains available');
 foreach ([['md5', true], ['sha256', true], ['md5salt', true], ['MD5', false], ['bcrypt', false], [null, false]] as [$algorithm, $expected]) {
     $user->update(['password_algo' => $algorithm, 'password_salt' => 'audit-salt']);
     $response = $as($adminPath.'/user/fetch', $adminToken, ['filter' => [['key' => 'id', 'condition' => '=', 'value' => $user->id]]]);
     $row = json_decode($response->getContent(), true)['data'][0] ?? [];
     $assert($response->getStatusCode() === 200 && ($row['uses_legacy_password'] ?? null) === $expected
         && !array_intersect($secrets, array_keys($row)), 'Administrator list summarizes the legacy password state without raw credentials');
 }
 $user->update(['password_salt' => null]);
 $r=$as($adminPath.'/user/getUserInfoById',$adminToken,['id'=>$user->id]);
 $detail=json_decode($r->getContent(),true)['data']??[];
 $assert($r->getStatusCode()===200 && ($detail['id']??null)===$user->id && !array_intersect($secrets,array_keys($detail)),'Administrator details omit raw credentials');
 $inviter=$detail['invite_user']??[];
 $assert(($inviter['id']??null)===$admin->id && ($inviter['email']??null)===$admin->email && !array_diff(array_keys($inviter),['id','email']),'Inviter is projected to identity fields only');
 $ordinaryAuth=new App\Services\AuthService($user);
 $ordinaryToken=$ordinaryAuth->generateAuthData(Request::create('/'))['auth_data'];
 $userAuth=$ordinaryAuth;
 foreach ([$token,$ordinaryToken] as $credential) {
     foreach (['user/fetch','user/getUserInfoById'] as $endpoint) {
         $assert($as($adminPath.'/'.$endpoint,$credential,['id'=>$admin->id])->getStatusCode()===403,'Non-administrator sessions cannot read administrator account resources');
     }
 }
 $r=$as('/api/v10/me','Bearer '.$ordinaryToken,['id'=>$admin->id,'user'=>['id'=>$admin->id,'is_admin'=>1]]);
 $me=json_decode($r->getContent(),true)['data']??[];
 $assert($r->getStatusCode()===200 && ($me['id']??null)===$user->id && !array_intersect(['password','password_algo','password_salt','uses_legacy_password','token'],array_keys($me)),'Account info ignores forged user context and exposes no password or subscription token');

 // User migration requires an authenticated admin browser and binds each confirmation to its preview.
 $importOrigin = 'https://migration.example.test';
 $browserSessions = app(App\Services\BrowserSession::class);
 $importSessions = [];
 $makeImportSession = function (User $actor, string $scope = 'admin', ?int $authenticatedAt = null) use ($browserSessions, $importOrigin, &$importSessions) {
     $request = Request::create($importOrigin.'/api/v10/auth/sessions', 'POST');
     $record = $browserSessions->load($request, $scope);
     $request->attributes->set('browser.session', $record);
     if ($authenticatedAt !== null) $request->attributes->set('auth.authenticatedAt', $authenticatedAt);
     $credential = (new App\Services\AuthService($actor))->generateAuthData($request)['auth_data'];
     $record = $browserSessions->rotate($record, $credential);
     $browserSessions->persist($record, response('', 204));
     $importSessions[] = $record;
     return $record;
 };
 $importSubnet = '2001:db8:'.bin2hex(random_bytes(2)).':'.bin2hex(random_bytes(2)).'::';
 $importRequests = 0;
 $import = function (string $endpoint, string $contents, ?array $browser = null, array $fields = [], array $headers = []) use ($kernel, $adminPath, $browserSessions, $importOrigin, $importSubnet, &$importRequests) {
     $file = \Illuminate\Http\UploadedFile::fake()->createWithContent('users.json', $contents);
     $cookies = [];
     if ($browser !== null) {
         $cookies[$browserSessions->cookieName($browser['scope'])] = $browser['id'];
         $headers += ['HTTP_X_BROWSER_CLIENT' => $browser['scope'], 'HTTP_X_CSRF_TOKEN' => $browser['csrfToken']];
     }
     $headers += [
         'HTTP_ORIGIN' => $importOrigin, 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'multipart/form-data',
         'REMOTE_ADDR' => $importSubnet.dechex(++$importRequests),
     ];
     $headers = array_filter($headers, static fn ($value) => $value !== null);
     return $kernel->handle(Request::create($importOrigin.$adminPath.'/user/'.$endpoint, 'POST', $fields, $cookies, ['file' => $file], $headers));
 };
 $tag = bin2hex(random_bytes(5));
 $email = 'migration-'.$tag.'@example.com';
 $lateEmail = 'migration-late-'.$tag.'@example.com';
 $heldEmail = 'migration-review-'.$tag.'@example.com';
 $duplicateEmail = 'migration-duplicate-'.$tag.'@example.com';
 $weakEmail = 'migration-weak-'.$tag.'@example.com';
 $highCostEmail = 'migration-high-cost-'.$tag.'@example.com';
 $password = 'ImportedFixture!2026';
 $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
 $weakHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 9]);
 $highCostHash = substr_replace($passwordHash, '15', 4, 2);
 $importRow = fn (int $id, string $address, array $overrides = []) => $overrides + [
     'source_user_id' => $id, 'email' => $address, 'password_hash' => $passwordHash, 'currency' => 'CNY',
     'wallet_balance' => 150, 'before_cutoff_credit' => 200, 'after_cutoff_credit' => 350, 'review_reasons' => [],
 ];
 $batch = [
     'version' => 1, 'source_site' => 'fixture-'.$tag, 'cutoff_at' => 1777564800, 'snapshot_at' => 1786013277,
     'users' => [
         $importRow(1, strtoupper($email)),
         $importRow(2, strtoupper($user->email)),
         $importRow(3, $heldEmail, ['review_reasons' => ['pre_cutoff_entitlement_unknown', 'private_note_should_not_echo']]),
         $importRow(4, $lateEmail, ['currency' => 'USD']),
         $importRow(5, $duplicateEmail),
         $importRow(6, strtoupper($duplicateEmail)),
         $importRow(7, $weakEmail, ['password_hash' => $weakHash]),
         $importRow(8, $highCostEmail, ['password_hash' => $highCostHash]),
     ],
 ];
 $contents = json_encode($batch, JSON_THROW_ON_ERROR);
 $beforeCollision = $user->fresh()->only(['password', 'balance', 'email', 'currency', 'token', 'uuid']);
 $adminCurrency = config('fastai.new_user_currency', 'CNY');
 config(['fastai.new_user_currency' => 'USD']);
 try {
     $adminBrowser = $makeImportSession($admin);
     $sameAdminBrowser = $makeImportSession($admin);
     $otherAdminBrowser = $makeImportSession($make('admin'));
     $userScopeBrowser = $makeImportSession($admin, 'user');
     $staleAdminBrowser = $makeImportSession($admin, 'admin', time() - 301);
     $beforeImport = User::count();

     $assert($import('importPreview', $contents, null, [], ['HTTP_AUTHORIZATION' => $ordinaryToken])->getStatusCode() === 403,
         'Ordinary sessions cannot preview credential migration');
     $assert($import('importPreview', $contents, null, [], ['HTTP_AUTHORIZATION' => $adminToken])->getStatusCode() === 403,
         'Administrator Authorization header alone cannot preview a credential migration');
     $assert($import('importPreview', $contents, $userScopeBrowser)->getStatusCode() === 403,
         'An administrator cookie in the user scope does not authorize migration');
     $assert($import('importPreview', $contents, $adminBrowser, [], ['HTTP_X_CSRF_TOKEN' => null])->getStatusCode() === 419,
         'Browser migration preview requires CSRF');
     $assert($import('importPreview', $contents, $adminBrowser, [], ['HTTP_ORIGIN' => 'https://untrusted.example.test'])->getStatusCode() === 419,
         'Browser migration preview requires a trusted Origin');

     $response = $import('importPreview', $contents, $adminBrowser);
     $preview = json_decode($response->getContent(), true)['data'] ?? [];
     $assert($response->getStatusCode() === 200 && ($preview['ready'] ?? null) === 2 && $preview['existing_email'] === 1
         && $preview['needs_review'] === 3 && $preview['conflicts'] === 2 && $preview['totals'] === ['CNY' => 700, 'USD' => 700],
         'Preview counts only verified importable accounts and currency totals');
     $bySourceId = array_column($preview['rows'], null, 'source_user_id');
     foreach ([7, 8] as $id) {
         $assert($bySourceId[$id]['state'] === 'needs_review' && in_array('password_hash_cost_out_of_range', $bySourceId[$id]['review_reasons'], true),
             'An unsupported bcrypt cost is held for review without blocking the rest of the file');
     }
     $assert(str_contains((string)$response->headers->get('Cache-Control'), 'no-store') && !str_contains($response->getContent(), $passwordHash)
         && !str_contains($response->getContent(), $weakHash) && !str_contains($response->getContent(), $highCostHash)
         && !str_contains($response->getContent(), 'private_note_should_not_echo') && User::count() === $beforeImport,
         'Preview is uncacheable, discloses no password material and creates no accounts');

     $apply = ['preview_token' => $preview['preview_token']];
     $assert($import('importApply', $contents, null, $apply, ['HTTP_AUTHORIZATION' => $adminToken])->getStatusCode() === 403,
         'Administrator Authorization header alone cannot confirm a credential migration');
     $assert($import('importApply', $contents, $adminBrowser, $apply, ['HTTP_X_CSRF_TOKEN' => null])->getStatusCode() === 419,
         'Browser migration confirmation requires CSRF');
     $assert($import('importApply', $contents.' ', $adminBrowser, $apply)->getStatusCode() === 409,
         'Apply is bound to the exact reviewed file bytes');
     $assert($import('importApply', $contents, $otherAdminBrowser, $apply)->getStatusCode() === 409,
         'Apply is bound to the previewing administrator');
     $assert($import('importApply', $contents, $sameAdminBrowser, $apply)->getStatusCode() === 409,
         'Another browser session for the same administrator cannot reuse a preview');

     $staleResponse = $import('importPreview', $contents, $staleAdminBrowser);
     $stalePreview = json_decode($staleResponse->getContent(), true)['data'] ?? [];
     $assert($staleResponse->getStatusCode() === 200 && is_string($stalePreview['preview_token'] ?? null),
         'An authenticated administrator can preview without recent login assurance');
     $staleApply = $import('importApply', $contents, $staleAdminBrowser, ['preview_token' => $stalePreview['preview_token']]);
     $staleProblem = json_decode($staleApply->getContent(), true) ?? [];
     $assert($staleApply->getStatusCode() === 409 && str_contains($staleProblem['message'] ?? '', '重新登录')
         && str_contains((string)$staleApply->headers->get('Cache-Control'), 'no-store') && User::count() === $beforeImport,
         'An old login cannot confirm migration even with its own valid preview');

     User::create(['email' => $lateEmail, 'password' => $passwordHash, 'balance' => 13,
         'uuid' => App\Utils\Helper::guid(true), 'token' => App\Utils\Helper::guid()]);
     $response = $import('importApply', $contents, $adminBrowser, $apply);
     $applied = json_decode($response->getContent(), true)['data'] ?? [];
     $assert($response->getStatusCode() === 200 && ($applied['created'] ?? null) === 1 && $applied['skipped'] === 7
         && $applied['totals'] === ['CNY' => 700, 'USD' => 0],
         'Rejected attempts do not burn the original preview and confirmation rechecks destination emails');
     $assert(count($applied) === 3 && str_contains((string)$response->headers->get('Cache-Control'), 'no-store')
         && !str_contains($response->getContent(), $email) && !str_contains($response->getContent(), $passwordHash)
         && !str_contains($response->getContent(), $preview['preview_token']),
         'Confirmation returns only uncacheable aggregate results');
     $account = User::where('email', $email)->firstOrFail();
     $assert($account->password === $passwordHash && $account->currency === 'CNY' && $account->balance === 700
         && !$account->is_admin && !$account->banned && $account->plan_id === null && !$account->transfer_enable,
         'Migration preserves the original bcrypt hash and explicit currency and grants only wallet balance');
     $assert($user->fresh()->only(array_keys($beforeCollision)) === $beforeCollision
         && User::where('email', $lateEmail)->value('balance') === 13
         && !User::whereIn('email', [$heldEmail, $duplicateEmail, $weakEmail, $highCostEmail])->exists(),
         'Destination collisions preserve existing accounts while held or conflicting rows receive no credits');
     $entry = DB::table('v2_user_migration')->where('source_site', $batch['source_site'])->sole();
     $assert((int)$entry->user_id === $account->id && (int)$entry->administrator_id === $admin->id
         && (int)$entry->wallet_balance === 150 && (int)$entry->before_cutoff_credit === 200 && (int)$entry->after_cutoff_credit === 350,
         'A successful import records each balance component and the acting administrator');

     $retry = $import('importApply', $contents, $adminBrowser, $apply);
     $assert($retry->getStatusCode() === 409 && (int)$account->fresh()->balance === 700
         && DB::table('v2_user_migration')->where('source_site', $batch['source_site'])->count() === 1,
         'A consumed confirmation cannot be reused or issue another credit');
     $batch['users'] = [$importRow(1, 'migration-renamed-'.$tag.'@example.com')];
     $response = $import('importPreview', json_encode($batch, JSON_THROW_ON_ERROR), $adminBrowser);
     $assert($response->getStatusCode() === 200 && (json_decode($response->getContent(), true)['data']['already_imported'] ?? null) === 1,
         'Stable source identity prevents a new credit even when the source email changes');

     $login = $kernel->handle(Request::create('/api/v10/auth/sessions', 'POST', ['email' => $email, 'password' => $password],
         [], [], ['HTTP_ACCEPT' => 'application/json']));
     $assert($login->getStatusCode() === 200 && is_string(json_decode($login->getContent(), true)['data']['accessToken'] ?? null),
         'The original password succeeds through the normal V10 login after migration');
     (new App\Services\AuthService($account))->removeAllSession();
 } finally {
     foreach ($importSessions as $record) $browserSessions->destroy($record);
     config(['fastai.new_user_currency' => $adminCurrency]);
 }

 $filter=[['key'=>'id','condition'=>'=','value'=>$user->id]];
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>$filter]);
 $assert($r->getStatusCode()===404 && $user->fresh()->banned===0,'Retired staff ban cannot mutate an ordinary user');
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>[['key'=>'id','condition'=>'=','value'=>$admin->id]]]);
 $assert($r->getStatusCode()===404 && !$admin->fresh()->banned,'Retired staff batch ban cannot mutate administrators');
 $r=$call('/api/v1/staff/user/ban','POST',['filter'=>[['key'=>'password','condition'=>'=','value'=>'x']]]);
 $assert($r->getStatusCode()===404,'Retired staff filtering is inaccessible');
 $r=$call('/api/v1/staff/user/sendMail','POST',['filter'=>$filter,'subject'=>'Audit fixture','content'=>'Fixture','purpose'=>'service','request_key'=>(string)Illuminate\Support\Str::uuid()]);
 $assert($r->getStatusCode()===404,'Retired staff mail cannot be dispatched');
 \Illuminate\Support\Facades\Queue::assertNotPushed(\App\Jobs\SendEmailJob::class);
 $r=$call('/api/v1/staff/user/sendMail','POST',['filter'=>[['key'=>'id','condition'=>'=','value'=>$admin->id]],'subject'=>'Audit fixture','content'=>'Fixture']);
 \Illuminate\Support\Facades\Queue::assertNotPushed(\App\Jobs\SendEmailJob::class);
 $userAuth=new App\Services\AuthService($user);$userToken=$userAuth->generateAuthData(Request::create('/'))['auth_data'];
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$user->id,'email'=>$user->email,'password'=>'Changed-test-123','banned'=>0]);
 $assert($r->getStatusCode()===404 && password_verify('Original-test-123',$user->fresh()->password),'Retired staff update cannot change ordinary user password');
 $assert(App\Services\AuthService::decryptAuthData($userToken)!==false,'Rejected staff password reset cannot revoke target sessions');
 foreach (['password','email'] as $changed) {
     $beforeChange=$userAuth->generateAuthData(Request::create('/'))['auth_data'];
     $params=['id'=>$user->id,'email'=>$user->fresh()->email,'banned'=>0,'is_admin'=>0];
     $params[$changed]=$changed==='password'?'Admin-reset-test-123':'admin-updated-'.bin2hex(random_bytes(5)).'@example.com';
     $detail=$as($adminPath.'/user/getUserInfoById',$adminToken,['id'=>$user->id]);
     $params['edit_versions']=array_intersect_key(json_decode($detail->getContent(),true)['data']['edit_versions'],$params);
     $r=$kernel->handle(Request::create($adminPath.'/user/update','POST',$params,[],[],['HTTP_AUTHORIZATION'=>$adminToken,'HTTP_ACCEPT'=>'application/json']));
     $assert($r->getStatusCode()===200 && !App\Services\AuthService::decryptAuthData($beforeChange),'Administrative '.$changed.' change revokes previous user sessions');
 }
 $r=$call('/api/v1/staff/user/update','POST',['id'=>$restricted->id,'email'=>$restricted->email,'password'=>'Changed-test-123','banned'=>0]);
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

 $gateway=App\Models\Payment::create(['name'=>'Audit MGate','payment'=>'MGate','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['mgate_app_id'=>'audit-app','mgate_app_secret'=>'audit-key','mgate_source_currency'=>'CNY']]);
 $gatewayOrder=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'payment_id'=>$gateway->id,'status'=>0]);
 $mgateNotify=function($amount,$currency='CNY')use($gateway,$gatewayOrder){
     $params=['out_trade_no'=>$gatewayOrder->trade_no,'trade_no'=>'mgate-fixture','app_id'=>'audit-app','source_currency'=>$currency];
     if ($amount !== null) $params['total_amount']=$amount;
     ksort($params);$params['sign']=md5(http_build_query($params).'audit-key');
     return (new App\Services\Actions\Guest\PaymentActions())->notify('MGate',$gateway->uuid,Request::create('/','POST',$params));
 };
 foreach ([[null,'CNY'],['1','CNY'],['1000','USD']] as $args) {
     try {$mgateNotify(...$args);throw new RuntimeException('Incomplete MGate settlement accepted');}
     catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($gatewayOrder->fresh()->status===0,'MGate missing/mismatched amount and currency preserve pending order');}
 }
 $assert($mgateNotify('1000')==='success' && $gatewayOrder->fresh()->status===1,'Exact signed MGate amount settles');
 $assert($mgateNotify('1000')==='success','MGate duplicate callback remains idempotent');
 $key=openssl_pkey_new(['private_key_bits'=>2048]);$public=openssl_pkey_get_details($key)['key'];
 $alipay=App\Models\Payment::create(['name'=>'Audit Alipay','payment'=>'AlipayF2F','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['app_id'=>'audit-app','private_key'=>'fixture','public_key'=>preg_replace('/-----[^-]+-----|\s+/','',$public)]]);
 $alipayOrder=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'payment_id'=>$alipay->id,'status'=>0]);
 $alipayNotify=function($amount,$appId='audit-app')use($alipay,$alipayOrder,$key){
     $params=['trade_status'=>'TRADE_SUCCESS','app_id'=>$appId,'out_trade_no'=>$alipayOrder->trade_no,'trade_no'=>'alipay-fixture','total_amount'=>$amount];
     ksort($params);$pairs=[];foreach($params as $name=>$value)$pairs[]=$name.'='.$value;
     openssl_sign(implode('&',$pairs),$signature,$key,OPENSSL_ALGO_SHA256);$params['sign']=base64_encode($signature);$params['sign_type']='RSA2';
     return (new App\Services\Actions\Guest\PaymentActions())->notify('AlipayF2F',$alipay->uuid,Request::create('/','POST',$params));
 };
 foreach ([['0.01','audit-app'],['10.00','different-app']] as $args) {
     try {$alipayNotify(...$args);throw new RuntimeException('Wrong Alipay amount or merchant accepted');}
     catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($alipayOrder->fresh()->status===0,'Alipay requires exact amount and configured app even with a valid provider signature');}
 }
 $assert($alipayNotify('10.00')==='success' && $alipayOrder->fresh()->status===1,'Signed Alipay exact amount settles');
 DB::table('v2_exchange_rate')->where('id',1)->update(['usd_cny_micros'=>7200000,'quoted_at'=>time(),'fetched_at'=>time()]);
 foreach (App\Services\PaymentQuote::LEGACY_STRIPE as $provider) {
     $channel=App\Models\Payment::create(['name'=>'Audit '.$provider,'payment'=>$provider,'currency'=>'CNY','uuid'=>App\Utils\Helper::guid(),'enable'=>1,'config'=>['currency'=>'USD','stripe_sk_live'=>'sk_test_fixture','stripe_webhook_key'=>'whsec_legacy','payment_method'=>'cards']]);
     $legacy=App\Models\Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'handling_amount'=>0,'payment_id'=>$channel->id,'status'=>0]);
     $quote=App\Services\PaymentQuote::make($legacy,$channel);
     $assert($quote['payment_amount']===139 && $quote['payment_currency']==='USD','Legacy Stripe uses an immutable CNY/USD settlement quote');
     App\Services\OrderPaymentHistory::select($legacy,$channel,$quote);
     $stripeConfig=$channel->config+['id'=>$channel->id,'uuid'=>$channel->uuid];
     $outgoing=App\Services\LegacyStripeSettlement::payment(['currency'=>'USD','total_amount'=>$quote['payment_amount']],$stripeConfig);
     $assert($outgoing===['amount'=>139,'currency'=>'usd'],'Outgoing Stripe request uses exact saved minor units');
     $sourceData=['id'=>'src_fixture','amount'=>139,'currency'=>'usd','metadata'=>['out_trade_no'=>$legacy->trade_no,'user_id'=>$legacy->user_id]];
     $source=\Stripe\StripeObject::constructFrom($sourceData);
     $assert(App\Services\LegacyStripeSettlement::source($source,$stripeConfig)['amount']===139,'Chargeable source is checked against the selected channel and snapshot');
     foreach ([['amount'=>1],['currency'=>'cny'],['metadata'=>['out_trade_no'=>$legacy->trade_no,'user_id'=>$legacy->user_id+1]]] as $invalid) {
         try {App\Services\LegacyStripeSettlement::source(\Stripe\StripeObject::constructFrom(array_replace($sourceData,$invalid)),$stripeConfig);throw new RuntimeException('Invalid chargeable source accepted');}
         catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$checks++;}
     }
     $legacyNotify=function($amount,$currency='usd',$captured=true,$valid=true)use($provider,$channel,$legacy,$app){
         $type=$provider==='StripeALL'?'payment_intent.succeeded':'charge.succeeded';
         $payload=json_encode(['id'=>'evt_legacy','object'=>'event','type'=>$type,'data'=>['object'=>['object'=>$provider==='StripeALL'?'payment_intent':'charge','id'=>'legacy-fixture','status'=>'succeeded','paid'=>true,'captured'=>$captured,'amount'=>$amount,'amount_received'=>$amount,'amount_captured'=>$amount,'currency'=>$currency,'metadata'=>['out_trade_no'=>$legacy->trade_no,'user_id'=>$legacy->user_id]]]]);
         $timestamp=time();$signature=hash_hmac('sha256',$timestamp.'.'.$payload,$valid?'whsec_legacy':'wrong');
         $request=Request::create('/','POST',[],[],[],['HTTP_STRIPE_SIGNATURE'=>"t=$timestamp,v1=$signature"],$payload);
         $previous=$app->make('request');$app->instance('request',$request);
         try {return (new App\Services\Actions\Guest\PaymentActions())->notify($provider,$channel->uuid,$request);}
         finally {$app->instance('request',$previous);}
     };
     foreach ([[1,'usd',true,true],[139,'cny',true,true],[139,'usd',true,false]] as $args) {
         try {$legacyNotify(...$args);throw new RuntimeException('Invalid legacy Stripe settlement accepted');}
         catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($legacy->fresh()->status===0,'Legacy Stripe rejects signed mismatched amount/currency and invalid signatures');}
     }
     if ($provider!=='StripeALL') $assert($legacyNotify(139,'usd',false)==='success' && $legacy->fresh()->status===0,'Uncaptured Stripe authorization does not settle');
     DB::table('v2_exchange_rate')->where('id',1)->update(['usd_cny_micros'=>9000000]);
     $assert(App\Services\PaymentQuote::make($legacy,$channel)['payment_amount']===139,'Changing current rates does not change a claimed legacy quote');
     $assert($legacyNotify(139)==='success' && $legacy->fresh()->status===1,'Exact legacy Stripe snapshot settles');
     $assert($legacyNotify(139)==='success','Legacy Stripe callback is idempotent');
     $assert(App\Services\LegacyStripeSettlement::source($source,$stripeConfig)===null,'Settled source replay does not create another charge');
     DB::table('v2_exchange_rate')->where('id',1)->update(['usd_cny_micros'=>7200000]);
 }

 echo "Audit security regression: $checks checks passed\n";
} finally {if($adminAuth)$adminAuth->removeAllSession();if($userAuth)$userAuth->removeAllSession();if($auth)$auth->removeAllSession();DB::rollBack();}
