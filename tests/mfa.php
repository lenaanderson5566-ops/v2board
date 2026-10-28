<?php

$app = require __DIR__.'/support/bootstrap.php';
require __DIR__ . '/commerce-bootstrap.php';
if (!getenv('COMMERCE_TEST_DATABASE')) throw new RuntimeException('Requires isolated database');

use App\Models\User;
use App\Services\{AuthService, MfaService, Totp, SessionAuthorizationCode};
use App\Jobs\SendEmailJob;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, Crypt, DB, Queue};

$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$fails = function ($action, $label, $status = null) use ($assert) {
    try { $action(); } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
        $assert($status === null || $error->getStatusCode() === $status, $label); return;
    }
    throw new RuntimeException($label);
};
$make = function ($body = [], $credential = '') {
    $request = Request::create('/api/v10/auth/mfa/verifications', 'POST', $body, [], [], ['HTTP_USER_AGENT' => 'MfaIntegration', 'REMOTE_ADDR' => '192.0.2.12']);
    if ($credential) $request->headers->set('Authorization', 'Bearer ' . $credential);
    app()->instance('request', $request);
    return $request;
};
$user = fn($name, $admin = false) => User::create(['email' => $name . '@example.test', 'password' => password_hash('MfaFixture!2026', PASSWORD_DEFAULT),
    'token' => bin2hex(random_bytes(16)), 'uuid' => Illuminate\Support\Str::uuid(), 'transfer_enable' => 0, 'is_admin' => $admin, 'balance' => 1234]);
$mailCode = function () {
    $job = Queue::pushed(SendEmailJob::class)->last();
    $property = new ReflectionProperty($job, 'params');
    return $property->getValue($job)['template_value']['code'];
};
$service = new MfaService();
// RFC 6238 SHA-1 vectors, reduced to the configured six digits.
$rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
foreach ([[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']] as [$time,$expected]) {
    $assert(Totp::code($rfcSecret, intdiv($time, 30)) === $expected, 'RFC TOTP vector');
}
$assert(strlen(Totp::secret()) === 32 && Totp::match($rfcSecret, 'invalid') === null, 'Secret entropy and code format');
DB::beginTransaction();
try {
    foreach ([false, true] as $admin) {
        config(['v2board.mfa_enable' => 0]);
        Cache::flush(); Queue::fake();
        $account = $user($admin ? 'mfa-admin' : 'mfa-user', $admin);
        $request = $make();
        $assert($service->state($account->id) === ['emailEnabled'=>false,'totpEnabled'=>false,'recoveryCodesRemaining'=>0,'enrollmentEnabled'=>false], 'Site enrollment and factors default off for both roles');
        foreach (['setupTotp', 'enableEmail'] as $purpose) $fails(fn()=>$service->start($account,$make(['purpose'=>$purpose,'password'=>'MfaFixture!2026'])), 'Disabled site rejects new factor enrollment',403);
        config(['v2board.mfa_enable' => 1]);
        $old = (new AuthService($account))->generateAuthData($request)['auth_data'];
        $oldLink = (new SessionAuthorizationCode())->issue(SessionAuthorizationCode::BROWSER, $old);
        $fails(fn()=>$service->start($account,$make(['purpose'=>'setupTotp','password'=>'wrong'],$old)), 'Password required', 422);
        $setup = $service->start($account,$make(['purpose'=>'setupTotp','password'=>'MfaFixture!2026'],$old));
        $assert(!$service->state($account->id)['totpEnabled'], 'Staged secret is not enabled');
        $fails(fn()=>$service->finish($setup['challengeId'],$make(['totpCode'=>'000000'],$old)), 'Must prove new authenticator', 422);
        $enrollmentCode=Totp::code($setup['secret'],intdiv(time(),30));
        config(['v2board.mfa_enable' => 0]);
        $fails(fn()=>$service->finish($setup['challengeId'],$make(['totpCode'=>$enrollmentCode],$old)), 'Switch off blocks an already-issued enrollment challenge',403);
        config(['v2board.mfa_enable' => 1]);
        $enabled = $service->finish($setup['challengeId'],$make(['totpCode'=>$enrollmentCode],$old));
        $assert(count($enabled['recoveryCodes']) === 10 && $service->state($account->id)['totpEnabled'], 'Enable after proof with recovery codes');
        $assert(strlen(str_replace('-','',$enabled['recoveryCodes'][0]))===32, '128-bit recovery entropy');
        $row = DB::table('v2_user_mfa')->where('user_id',$account->id)->first();
        $assert($row->totp_secret !== $setup['secret'] && !str_contains($row->recovery_hashes,$enabled['recoveryCodes'][0]), 'Encrypted secret and hashed recovery codes');
        $assert(AuthService::decryptAuthData($old) === false, 'Existing session revoked');
        try {(new SessionAuthorizationCode())->exchange(SessionAuthorizationCode::BROWSER,$oldLink);throw new RuntimeException('Old link accepted');}
        catch (Illuminate\Http\Exceptions\HttpResponseException $e) {$assert(true,'Old session link revoked');}
        $fails(fn()=>(new AuthService($account))->generateAuthData($make()), 'Direct issuance cannot bypass MFA',403);
        config(['v2board.mfa_enable' => 0]);
        $challenge = $service->login($account,$make());
        $assert($challenge['preferredMethod']==='totp' && $challenge['methods']===['totp','recovery'], 'TOTP priority');
        $fails(fn()=>$service->finish($challenge['challengeId'],$make(['verificationMethod'=>'totp','verificationCode'=>$enrollmentCode])), 'Enrollment code cannot replay',422);
        $auth = $service->finish($challenge['challengeId'],$make(['verificationMethod'=>'recovery','verificationCode'=>$enabled['recoveryCodes'][0]]))['auth']['auth_data'];
        $assert(AuthService::decryptAuthData($auth) !== false && $service->state($account->id)['recoveryCodesRemaining']===9, 'Recovery login once');
        DB::enableQueryLog(); DB::flushQueryLog(); AuthService::decryptAuthData($auth);
        $assert(count(DB::getQueryLog())===1, 'MFA version check uses the existing identity query'); DB::disableQueryLog();
        $fails(fn()=>$service->finish($challenge['challengeId'],$make()), 'Challenge consumed',409);
        $challenge = $service->login($account,$make());
        $fails(fn()=>$service->finish($challenge['challengeId'],$make(['verificationMethod'=>'recovery','verificationCode'=>$enabled['recoveryCodes'][0]])), 'Recovery code cannot replay',422);
        $fails(fn()=>$service->start($account,$make(['purpose'=>'disableTotp','password'=>'MfaFixture!2026'],$auth)), 'Password alone cannot disable',422);
        // A correctly authenticated session can produce a link without asking for the second factor again.
        $link=(new SessionAuthorizationCode())->issue(SessionAuthorizationCode::BROWSER,$auth);
        $verified=(new SessionAuthorizationCode())->exchange(SessionAuthorizationCode::BROWSER,$link);
        $exchange=$make();$exchange->attributes->set('mfa.verifiedUserId',(int)$account->id);$exchange->attributes->set('mfa.verifiedVersion',(int)$verified->getRelation('mfaAssurance')->version);
        $assert((new AuthService($verified))->generateAuthData($exchange)['auth_data'] !== '', 'Verified source exchange');
        $disabled = $service->start($account,$make(['purpose'=>'disableTotp','password'=>'MfaFixture!2026','verificationMethod'=>'recovery','verificationCode'=>$enabled['recoveryCodes'][1]],$auth));
        $service->finish($disabled['challengeId'],$make([],$auth));
        $assert(!$service->state($account->id)['totpEnabled'] && $service->state($account->id)['recoveryCodesRemaining']===0, 'Disable removes both secret and recovery codes');
        config(['v2board.mfa_enable' => 1]);
        $fails(fn()=>(new AuthService($verified))->generateAuthData($exchange), 'Previously verified source cannot mint after MFA is disabled',403);
        $assert($account->fresh()->balance===1234 && $account->fresh()->currency==='CNY', 'Funds preserved');
    }
    Cache::flush(); Queue::fake();
    $account=$user('mfa-email');$auth=(new AuthService($account))->generateAuthData($make())['auth_data'];
    $setup=$service->start($account,$make(['purpose'=>'enableEmail','password'=>'MfaFixture!2026'],$auth));
    $fails(fn()=>$service->finish($setup['challengeId'],$make([],$auth)),'Cannot enable unverified email',422);
    $service->sendEmail($setup['challengeId'],$make([],$auth));$code=$mailCode();
    $fails(fn()=>$service->sendEmail($setup['challengeId'],$make([],$auth)),'Email resend cooldown',429);
    $service->finish($setup['challengeId'],$make(['emailCode'=>$code],$auth));
    $challenge=$service->login($account,$make());$assert($challenge['preferredMethod']==='email','Email-only login');
    $service->sendEmail($challenge['challengeId'],$make());$code=$mailCode();
    $mismatched=$make(['verificationMethod'=>'email','verificationCode'=>$code]);$mismatched->headers->set('User-Agent','OtherClient');
    $fails(fn()=>$service->finish($challenge['challengeId'],$mismatched),'Challenge bound to client',409);
    $auth=$service->finish($challenge['challengeId'],$make(['verificationMethod'=>'email','verificationCode'=>$code]))['auth']['auth_data'];
    $setup=$service->start($account,$make(['purpose'=>'setupTotp','password'=>'MfaFixture!2026'],$auth));
    $assert($setup['emailRequired'],'Existing email must prove identity to add TOTP');
    $service->sendEmail($setup['challengeId'],$make([],$auth));$code=$mailCode();
    $service->finish($setup['challengeId'],$make(['emailCode'=>$code,'totpCode'=>Totp::code($setup['secret'],intdiv(time(),30))],$auth));
    $state=$service->state($account->id);$assert($state['emailEnabled'] && $state['totpEnabled'],'Both enabled');
    $challenge=$service->login($account,$make());$assert($challenge['preferredMethod']==='totp' && in_array('email',$challenge['methods'],true),'Both enabled prefer TOTP');
    $other=$user('mfa-other');$otherAuth=(new AuthService($other))->generateAuthData($make())['auth_data'];
    $fails(fn()=>$service->finish($setup['challengeId'],$make([],$otherAuth)),'Cross-account enrollment denied');
    echo "MFA integration: $checks checks passed; transaction rolled back.\n";
} finally {DB::rollBack(); Cache::flush();}
