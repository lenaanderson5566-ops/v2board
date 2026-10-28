<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local only');
use App\Models\User;
use App\Models\Order;
use App\Models\CommissionLog;
use App\Services\AdminUserIdentity;
use Illuminate\Support\Facades\DB;
DB::beginTransaction();
$auth = null; $accounts = [];
try {
$user = User::create(['email'=>'identity-'.bin2hex(random_bytes(5)).'@example.com','password'=>'fixture','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
$rows = collect([
    new Order(['user_id' => $user->id, 'invite_user_id' => $user->id]),
    new CommissionLog(['invite_user_id' => $user->id]),
    new Order(['user_id' => 2147483647]),
]);
DB::enableQueryLog();
DB::flushQueryLog();
AdminUserIdentity::append($rows);
$checks = 0;
$countAssert = \Tests\Support\Assertions::counter($checks);
$assert = fn($ok, $message = 'Identity projection failed') => $countAssert($ok, $message);
$assert(count(DB::getQueryLog()) === 1);
$assert($rows[0]->email === $user->email && $rows[0]->invite_email === $user->email);
$assert($rows[1]->invite_email === $user->email);
$assert($rows[2]->user_id === 2147483647 && $rows[2]->email === null);
$assert(!isset($rows[0]->password) && !isset($rows[0]->token));
DB::flushQueryLog();
AdminUserIdentity::append(collect());
$assert(count(DB::getQueryLog()) === 0);
DB::disableQueryLog();
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$admin = User::create(['email'=>'delete-admin-'.bin2hex(random_bytes(5)).'@example.com','password'=>password_hash('fixture-password',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>1]);
$auth = new App\Services\AuthService($admin);
$adminToken = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
$securePath = config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
$call = function ($action, $body, $credential = null) use ($kernel,$securePath,$adminToken) {
    $request = Illuminate\Http\Request::create('/api/v1/'.$securePath.'/user/'.$action,'POST',$body,[],[],['HTTP_ACCEPT'=>'application/json']);
    $request->headers->set('Authorization',$credential ?? $adminToken);
    return $kernel->handle($request);
};
$fixture = function ($label) use (&$accounts,$admin) {
    $user = User::create(['email'=>$label.'-'.bin2hex(random_bytes(5)).'@example.com','password'=>password_hash('fixture-password',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'plan_id'=>1,'group_id'=>1,'transfer_enable'=>10000,'credit_balance'=>5000,'expired_at'=>time()+86400,'telegram_id'=>random_int(100000000,900000000),'invite_user_id'=>$admin->id]);
    $session = new App\Services\AuthService($user);
    $tokens = [$session->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'],$session->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']];
    $accounts[] = $user;
    DB::table('v2_user_mfa')->insert(['user_id'=>$user->id,'email_enabled'=>1,'totp_secret'=>'fixture-secret','recovery_hashes'=>'["fixture-hash"]','version'=>0]);
    DB::table('v2_passkey')->insert(['user_id'=>$user->id,'credential_hash'=>hash('sha256',$user->email),'credential_id'=>'fixture','public_key'=>'fixture','user_handle'=>'fixture','rp_id'=>'example.test','name'=>'fixture','sign_count'=>0,'created_at'=>time()]);
    DB::table('v2_telegram_identity')->insert(['user_id'=>$user->id,'telegram_id'=>$user->telegram_id]);
    DB::table('v2_telegram_binding_challenge')->insert(['user_id'=>$user->id,'token_hash'=>hash('sha256',$user->email),'expires_at'=>time()+300]);
    DB::table('v2_telegram_preference')->insert(['user_id'=>$user->id,'telegram_id'=>$user->telegram_id,'updated_at'=>time()]);
    DB::table('v2_coupon_wallet')->insert(['user_id'=>$user->id,'coupon_id'=>123,'snapshot'=>'{}','created_at'=>time()]);
    DB::table('v2_notice_read')->insert(['user_id'=>$user->id,'notice_id'=>123,'notice_updated_at'=>time(),'read_at'=>time()]);
    DB::table('v2_invite_code')->insert(['user_id'=>$user->id,'code'=>bin2hex(random_bytes(16)),'created_at'=>time(),'updated_at'=>time()]);
    DB::table('v2_email_invitation')->insert(['user_id'=>$user->id,'email'=>$admin->email,'email_hash'=>hash('sha256',$admin->email),'token_hash'=>bin2hex(random_bytes(32)),'expires_at'=>time()+300,'last_requested_at'=>time(),'created_at'=>time(),'updated_at'=>time()]);
    DB::table('v2_mail_campaign_recipient')->insert(['user_id'=>$user->id,'campaign_id'=>123,'recipient_hash'=>hash('sha256',$user->email),'available_at'=>time(),'updated_at'=>time()]);
    DB::table('v2_client_diagnostic_report')->insert(['user_id'=>$user->id,'report_id'=>App\Utils\Helper::guid(true),'client_version'=>'test','platform'=>'windows','checks'=>'{}','created_at'=>time()]);
    $ticket = DB::table('v2_ticket')->insertGetId(['user_id'=>$user->id,'subject'=>'Private support record','level'=>1,'status'=>1,'created_at'=>time(),'updated_at'=>time()]);
    DB::table('v2_ticket_message')->insert(['user_id'=>$user->id,'ticket_id'=>$ticket,'message'=>'Private support message','created_at'=>time(),'updated_at'=>time()]);
    DB::table('v2_ticket_notification_read')->insert(['user_id'=>$user->id,'ticket_id'=>$ticket,'message_id'=>123,'read_at'=>time()]);
    Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>bin2hex(random_bytes(12)),'total_amount'=>100,'status'=>3]);
    DB::table('v2_credit_batch')->insert(['user_id'=>$user->id,'reference'=>'admin-delete:'.$user->id,'remaining_bytes'=>5000,'expires_at'=>time()+86400,'created_at'=>time()]);
    DB::table('v2_usage_reset_credit')->insert(['user_id'=>$user->id,'batch_id'=>123,'quantity'=>3,'remaining'=>3,'created_at'=>time()]);
    $browser = app(App\Services\BrowserSession::class);
    $request = Illuminate\Http\Request::create('https://delete.example/api/v10/me');
    $record = $browser->rotate($browser->load($request,'user'),$tokens[0]);
    $browser->persist($record,response('',204));
    $code = app(App\Services\SessionAuthorizationCode::class)->issue(App\Services\SessionAuthorizationCode::BROWSER,$tokens[0]);
    return [$user,$tokens,$record,$code];
};
$verify = function ($fixture) use ($assert,$kernel) {
    [$user,$tokens,$record,$code] = $fixture;
    $assert(User::find($user->id)===null,'Administrator deletion removes account identity');
    foreach (['v2_user_mfa','v2_passkey','v2_telegram_identity','v2_telegram_binding_challenge','v2_telegram_preference','v2_coupon_wallet','v2_notice_read','v2_invite_code','v2_email_invitation','v2_mail_campaign_recipient','v2_client_diagnostic_report','v2_ticket','v2_ticket_message','v2_ticket_notification_read','v2_order'] as $table) {
        $assert(!DB::table($table)->where('user_id',$user->id)->exists(),'Administrator erases account-owned rows: '.$table);
    }
    $assert((int)DB::table('v2_credit_batch')->where('user_id',$user->id)->value('remaining_bytes')===0 && (int)DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->value('remaining')===0,'Administrator invalidates all remaining entitlements');
    foreach ($tokens as $token) $assert(!App\Services\AuthService::decryptAuthData($token),'Every native session is rejected');
    $assert((new App\Services\AuthService($user))->getSessions()===[],'Administrator clears session metadata');
    $browser = app(App\Services\BrowserSession::class);
    $request = Illuminate\Http\Request::create('https://delete.example/api/v10/me','GET',[],[$browser->cookieName('user')=>$record['id']],[],['HTTP_X_BROWSER_CLIENT'=>'user','HTTP_ACCEPT'=>'application/json']);
    $assert($kernel->handle($request)->getStatusCode()===401,'Old browser cookie cannot access deleted account');
    try { app(App\Services\SessionAuthorizationCode::class)->exchange(App\Services\SessionAuthorizationCode::BROWSER,$code); $assert(false,'Old authorization code accepted'); }
    catch (Illuminate\Http\Exceptions\HttpResponseException $error) { $assert($error->getResponse()->getStatusCode()===409,'Old login authorization code is rejected'); }
    foreach (['','/application-config','/application-version'] as $suffix) {
        $request = Illuminate\Http\Request::create('/api/v10/subscriptions/'.$user->token.$suffix,'GET',[],[],[],['HTTP_ACCEPT'=>'application/json']);
        $assert($kernel->handle($request)->getStatusCode()===403,'Old subscription endpoint is rejected: '.$suffix);
    }
    $mail = (new App\Jobs\SendEmailJob(['user_id'=>$user->id,'email'=>$user->email,'template_name'=>'notify']))->handle();
    $assert(($mail['reason'] ?? null)==='ACCOUNT_DELETED','Previously queued mail is suppressed after hard deletion');
};
$single = $fixture('single-delete');
$control = $fixture('delete-control');
$assert($call('delUser',['id'=>0])->getStatusCode()===422,'Invalid deletion id is rejected');
$assert($call('delUser',['id'=>$single[0]->id],$control[1][0])->getStatusCode()===403,'Non-administrators cannot delete users');
$failSingle = true;
Illuminate\Support\Facades\Event::listen(Illuminate\Database\Events\QueryExecuted::class,function ($query) use (&$failSingle,$single) {
    if ($failSingle && str_starts_with(strtolower($query->sql),'update') && str_contains($query->sql,'v2_usage_reset_credit') && in_array($single[0]->id,$query->bindings,true)) { $failSingle=false; throw new RuntimeException('Fixture single cleanup failure'); }
});
$assert($call('delUser',['id'=>$single[0]->id])->getStatusCode()===500,'Unexpected single-user cleanup failure aborts deletion');
$assert(User::find($single[0]->id) && DB::table('v2_passkey')->where('user_id',$single[0]->id)->exists(),'Single-user failure restores identity and credentials');
$assert((int)DB::table('v2_credit_batch')->where('user_id',$single[0]->id)->value('remaining_bytes')===5000 && App\Services\AuthService::decryptAuthData($single[1][0]),'Single-user failure restores entitlements and preserves the unrevoked session');
$assert($call('delUser',['id'=>$single[0]->id])->getStatusCode()===200,'Single-user deletion succeeds');
$verify($single);
$batchA = $fixture('batch-delete');
$batchB = $fixture('batch-delete');
$batchB[0]->update(['invite_user_id'=>$batchA[0]->id]);
$filter = [['key'=>'email','condition'=>'模糊','value'=>'batch-delete-'],['key'=>'invite_user_id','condition'=>'>','value'=>0]];
$assert($call('allDel',['filter'=>[]])->getStatusCode()===422,'Unscoped bulk deletion is rejected');
$assert($call('allDel',['filter'=>$filter,'expected_count'=>3])->getStatusCode()===409,'Changed bulk target count is rejected');
$assert(User::find($batchA[0]->id) && User::find($batchB[0]->id),'Count mismatch leaves both accounts intact');
$failOnce = true;
Illuminate\Support\Facades\Event::listen(Illuminate\Database\Events\QueryExecuted::class,function ($query) use (&$failOnce,$batchB) {
    if ($failOnce && str_starts_with(strtolower($query->sql),'update') && str_contains($query->sql,'v2_usage_reset_credit') && in_array($batchB[0]->id,$query->bindings,true)) { $failOnce=false; throw new RuntimeException('Fixture cleanup failure'); }
});
$assert($call('allDel',['filter'=>$filter,'expected_count'=>2])->getStatusCode()===500,'Unexpected batch cleanup failure aborts the whole operation');
foreach ([$batchA,$batchB] as $item) {
    $assert(User::find($item[0]->id) && DB::table('v2_passkey')->where('user_id',$item[0]->id)->exists(),'Batch failure restores identities and credentials');
    $assert((int)DB::table('v2_credit_batch')->where('user_id',$item[0]->id)->value('remaining_bytes')===5000,'Batch failure restores entitlements');
}
$assert($call('allDel',['filter'=>$filter,'expected_count'=>2])->getStatusCode()===200,'Batch deletion succeeds even when erasure changes matching invite relationships');
$verify($batchA); $verify($batchB);
$assert(User::find($control[0]->id) && App\Services\AuthService::decryptAuthData($control[1][0]),'Unrelated identity and login session remain intact');
$assert((int)DB::table('v2_credit_batch')->where('user_id',$control[0]->id)->value('remaining_bytes')===5000 && DB::table('v2_passkey')->where('user_id',$control[0]->id)->exists(),'Unrelated credentials and entitlements remain intact');
echo "Administrator user identity and deletion: $checks checks passed\n";

} finally {
    DB::disableQueryLog();
    if ($auth) $auth->removeAllSession();
    foreach ($accounts as $account) (new App\Services\AuthService($account))->removeAllSession();
    DB::rollBack();
}
