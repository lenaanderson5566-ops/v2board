<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
set_exception_handler(function ($e) { fwrite(STDERR, $e->getMessage()."\n"); exit(1); });
$assert = \Tests\Support\Assertions::counter($checks);
$assert(App\Services\GeoIpService::maskSessionIp('203.0.113.47') === '203.0.113.***', 'IPv4 must be masked');
$assert(App\Services\GeoIpService::maskSessionIp('2001:db8:1234:5678::1') === '2001:db8:1234:****:****:****:****:****', 'IPv6 must be masked');
$assert(App\Services\GeoIpService::maskSessionIp('invalid') === null, 'Malformed IP should not be echoed');
$assert(app(App\Services\GeoIpService::class)->sessionCountry('127.0.0.1') === null, 'Private IP has no public location');
Illuminate\Support\Facades\DB::beginTransaction();
$auth = null; $cacheTokens = []; $limitKey = null;
$originalConfig = config('v2board');
try {
    $user = App\Models\User::create(['email'=>'auth-review-'.bin2hex(random_bytes(6)).'@example.com','password'=>password_hash('test-only-password',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'is_admin'=>1]);
    $auth = new App\Services\AuthService($user);
    $issue = function () use ($auth) { return $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']; };
    $token = $issue();
    $assert(!array_key_exists('is_staff',App\Services\AuthService::decryptAuthData($token)),'Authentication no longer exposes retired staff role metadata');
    $claims = (array)Firebase\JWT\JWT::decode($token, new Firebase\JWT\Key(config('app.key'),'HS256'));
    $assert($claims['exp']-$claims['iat'] === 30*86400, 'New token expiry missing');
    $legacy = Firebase\JWT\JWT::encode(['id'=>$user->id,'session'=>$claims['session']], config('app.key'),'HS256');
    $expired = Firebase\JWT\JWT::encode(['id'=>$user->id,'session'=>$claims['session'],'exp'=>time()-60], config('app.key'),'HS256');
    foreach ([$token,$legacy,$expired] as $cached) { Illuminate\Support\Facades\Cache::put($cached,$user->toArray(),3600); $cacheTokens[]=$cached; }
    $assert(App\Services\AuthService::decryptAuthData($legacy)['id']===$user->id, 'Existing legacy login must survive upgrade');
    $assert(App\Services\AuthService::decryptAuthData($expired)===false, 'Cache bypassed expiry');
    $user->update(['is_admin'=>0]);
    $assert(!App\Services\AuthService::decryptAuthData($token)['is_admin'], 'Cached role survived downgrade');
    $auth->removeSession($claims['session']);
    $assert(App\Services\AuthService::decryptAuthData($token)===false && App\Services\AuthService::decryptAuthData($legacy)===false, 'Removed session accepted cached token');
    $forged = Firebase\JWT\JWT::encode(['id'=>$user->id,'session'=>$claims['session']], str_repeat('incorrect-test-key',3),'HS256');
    Illuminate\Support\Facades\Cache::put($forged,$user->toArray(),3600); $cacheTokens[]=$forged;
    $assert(App\Services\AuthService::decryptAuthData($forged)===false, 'Cache bypassed signature verification');
    foreach ([['invalid'], ['is_staff'=>'1'], ['is_admin'=>'1'], ['id'=>$user->id, 'is_staff'=>1], null, 1, true, 'invalid-jwt'] as $malformed) {
        $assert(App\Services\AuthService::decryptAuthData($malformed)===false, 'Malformed or array credentials must never resolve through cache');
    }
    $first = $issue(); $second = $issue();
    $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
    $target = App\Models\User::create(['email'=>'staff-target-'.bin2hex(random_bytes(6)).'@example.com', 'password'=>password_hash('test-only-password',PASSWORD_DEFAULT), 'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(), 'is_admin'=>0]);
    foreach (['ticket/fetch'=>'GET','ticket/reply'=>'POST','ticket/close'=>'POST','user/update'=>'POST','user/getUserInfoById'=>'GET','user/sendMail'=>'POST','user/ban'=>'POST','plan/fetch'=>'GET','notice/fetch'=>'GET','notice/save'=>'POST','notice/drop'=>'POST'] as $endpoint=>$method) {
        foreach ([null,$second] as $credential) {
            $request=Illuminate\Http\Request::create('/api/v1/staff/'.$endpoint.'?auth_data[is_staff]=1&id='.$target->id,$method,[],[],[],['HTTP_ACCEPT'=>'application/json']);
            if ($credential!==null) $request->headers->set('Authorization',$credential);
            $retired=$kernel->handle($request);
            $assert($retired->getStatusCode()===404 && !isset(json_decode($retired->getContent(),true)['data']),'Retired staff route is unreachable even with a valid account session: '.$endpoint);
            foreach (['password','token','uuid'] as $field) $assert(!str_contains($retired->getContent(),$target->$field),'Retired response cannot leak '.$field);
        }
    }
    foreach ([$target->id,$user->id,2147483647] as $targetId) {
        $request=Illuminate\Http\Request::create('/api/v1/staff/user/getUserInfoById?auth_data[is_staff]=1&id='.$targetId,'GET',[],[],[],['HTTP_ACCEPT'=>'application/json']);
        $assert($kernel->handle($request)->getStatusCode()===404,'Original exploit cannot enumerate existing or missing accounts');
    }
    foreach ([['is_staff'=>'1'], ['is_admin'=>'1']] as $credential) {
        foreach ([false, true] as $json) {
            $request = $json
                ? Illuminate\Http\Request::create('/api/v1/protected','POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode(['auth_data'=>$credential]))
                : Illuminate\Http\Request::create('/api/v1/protected','POST',['auth_data'=>$credential]);
            try {
                (new App\Http\Middleware\Admin())->handle($request, function () { throw new RuntimeException('Array credential reached privileged action'); });
                throw new RuntimeException('Array body credential accepted');
            } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
                $assert($error->getStatusCode()===403,'Administrator rejects form and JSON array credentials');
            } catch (Symfony\Component\HttpFoundation\Exception\BadRequestException $error) {
                $assert(!$json,'Symfony rejects non-scalar form credentials before authentication');
            }
        }
    }
    $user->update(['is_admin'=>1]);
    $adminRequest=Illuminate\Http\Request::create('/api/v1/protected','GET',[],[],[],['HTTP_AUTHORIZATION'=>$second]);
    $assert((new App\Http\Middleware\Admin())->handle($adminRequest,fn()=>response('ok'))->getStatusCode()===200,'Current administrator role is accepted');
    $user->update(['is_admin'=>0]);
    try {
        (new App\Http\Middleware\Admin())->handle($adminRequest,fn()=>response('ok'));
        throw new RuntimeException('Downgraded administrator accepted');
    } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
        $assert($error->getStatusCode()===403,'Role downgrade takes effect for an existing session');
    }
    $logoutToken = $issue();
    $logoutRequest = Illuminate\Http\Request::create('/api/v1/user/logout?auth_data[is_admin]=1','POST',[],[],[],['HTTP_AUTHORIZATION'=>$logoutToken,'HTTP_ACCEPT'=>'application/json']);
    $logoutResponse = $kernel->handle($logoutRequest);
    $assert($logoutResponse->getStatusCode()===200 && (json_decode($logoutResponse->getContent(),true)['data']??null)===true && App\Services\AuthService::decryptAuthData($logoutToken)===false, 'Legacy logout revokes the verified header session despite forged query input');
    $call = function ($path,$token,$method='GET') use ($kernel) {
        $request = Illuminate\Http\Request::create('/api/v10/'.$path,$method);
        $request->headers->set('Authorization','Bearer '.$token); $request->headers->set('Accept','application/json');
        return $kernel->handle($request);
    };
    $sessionsResponse = $call('me/sessions',$first);
    $assert($sessionsResponse->getStatusCode()===200, 'Session list failed with HTTP '.$sessionsResponse->getStatusCode());
    $sessions = json_decode($sessionsResponse->getContent(),true)['data'];
    foreach ($sessions as $session) {
        $assert(array_key_exists('countryCode', $session), 'Session location contract missing');
        $assert(!filter_var($session['ip'] ?? '', FILTER_VALIDATE_IP), 'Session API leaked an unmasked IP');
    }
    $assert(count($sessions)===2 && count(array_filter($sessions,fn($meta)=>isset($meta['auth_data'])))===0, 'Session list leaked login tokens');
    $assert(count(array_filter($sessions,fn($meta)=>$meta['current'] ?? false))===1, 'Current session must be identified exactly once');
    $assert(count(array_filter($sessions,fn($meta)=>($meta['clientKind'] ?? null)==='native'))===2, 'Native session type missing');
    $before = $user->only(['token','uuid','password','plan_id']);
    $reset = $call('me/subscription/credential-rotations',$first,'POST'); $user->refresh();
    $assert($reset->getStatusCode()===200 && $user->token!==$before['token'] && $user->uuid!==$before['uuid'], 'Subscription credentials not rotated');
    $assert($user->password===$before['password'] && $user->plan_id===$before['plan_id'], 'Reset changed account credentials or plan');
    $assert(App\Services\AuthService::decryptAuthData($first)!==false, 'Subscription reset logged account out');
    $assert($call('me/session',$first,'DELETE')->getStatusCode()===204, 'Logout route failed');
    $assert(App\Services\AuthService::decryptAuthData($first)===false && App\Services\AuthService::decryptAuthData($second)!==false, 'Logout should revoke only current session');
    $assert($call('me',$first)->getStatusCode()===401, 'Revoked session still accesses API');
    $user->update(['is_admin'=>1,'banned'=>1]);
    foreach ([new App\Http\Middleware\Admin()] as $guard) {
        $request = Illuminate\Http\Request::create('/'); $request->headers->set('Authorization',$second);
        try { $guard->handle($request, fn()=>true); throw new RuntimeException('Banned privileged account accepted'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===403, 'Wrong ban response'); }
    }
    $user->update(['is_admin'=>0,'banned'=>0]);
    $limits = $originalConfig; unset($limits['password_limit_enable']);
    $limits['password_limit_count']=2; $limits['password_limit_expire']=1; $limits['recaptcha_enable']=0;
    config(['v2board'=>$limits]);
    $limitKey = App\Utils\CacheKey::get('PASSWORD_ERROR_LIMIT',strtolower($user->email));
    $login = function ($email,$password,$captcha=null) use ($kernel) {
        $request = Illuminate\Http\Request::create('/api/v1/passport/auth/login','POST',['email'=>$email,'password'=>$password,'recaptcha_data'=>$captcha]);
        $request->headers->set('Accept','application/json'); return $kernel->handle($request);
    };
    $login(strtoupper($user->email),'incorrect-password');
    $assert((int)Illuminate\Support\Facades\Cache::get($limitKey)===1, 'Default-enabled password limiter did not count');
    $login($user->email,'incorrect-password');
    $assert((int)Illuminate\Support\Facades\Cache::get($limitKey)===2, 'Case variation bypassed password limiter');
    $assert($login($user->email,'test-only-password')->getStatusCode()===500, 'Password limit not enforced');
    config(['v2board.recaptcha_enable'=>1]);
    $assert($login($user->email,'test-only-password')->getStatusCode()===422, 'Enabled CAPTCHA accepted a missing challenge');
    $auth->removeAllSession();
    $assert(App\Services\AuthService::decryptAuthData($second)===false, 'All-session revocation failed');
    echo "Authentication security: $checks checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    foreach ($cacheTokens as $cached) Illuminate\Support\Facades\Cache::forget($cached);
    if ($limitKey) Illuminate\Support\Facades\Cache::forget($limitKey);
    config(['v2board'=>$originalConfig]);
    Illuminate\Support\Facades\DB::rollBack();
}
