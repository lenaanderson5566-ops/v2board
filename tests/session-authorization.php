<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\AuthService;
use App\Services\SessionAuthorizationCode;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Exceptions\HttpResponseException;
$checks=0;
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$service=new SessionAuthorizationCode();
$keys=[]; $auth=null;
$key=function($purpose,$code) use (&$keys) { $key='SESSION_AUTHORIZATION:'.$purpose.':'.hash('sha256',$code); $keys[]=$key; return $key; };
$reject=function($purpose,$code,$expected) use ($service,$assert) {
    try { $service->exchange($purpose,$code); throw new RuntimeException('Rejected code accepted'); }
    catch (HttpResponseException $e) { $assert(json_decode($e->getResponse()->getContent(),true)['code']===$expected,'Stable rejection '.$expected); }
};
Illuminate\Support\Facades\DB::beginTransaction();
try {
    $user=App\Models\User::create(['email'=>bin2hex(random_bytes(8)).'@example.com','password'=>password_hash('Testing!2026',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
    $auth=new AuthService($user);
    $session=fn()=>$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    foreach ([SessionAuthorizationCode::BROWSER,SessionAuthorizationCode::APP] as $purpose) {
        $source=$session(); $code=$service->issue($purpose,$source); $cacheKey=$key($purpose,$code);
        $pending=Cache::get($cacheKey);
        $assert(isset($pending['source']['sessionId']) && !str_contains(json_encode($pending),$source),'No raw source credential stored');
        $other=$purpose===SessionAuthorizationCode::APP ? SessionAuthorizationCode::BROWSER : SessionAuthorizationCode::APP;
        $reject($other,$code,$other===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_EXPIRED':'SESSION_LINK_EXPIRED');
        $assert($service->exchange($purpose,$code)->id===$user->id,'Purpose isolation preserves original code');
        $reject($purpose,$code,$purpose===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_EXPIRED':'SESSION_LINK_EXPIRED');
        $code=$service->issue($purpose,$source); $key($purpose,$code); $auth->removeCurrentSession($source);
        $reject($purpose,$code,$purpose===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_INVALID':'SESSION_LINK_INVALID');
        $source=$session(); $code=$service->issue($purpose,$source); $cacheKey=$key($purpose,$code);
        $pending=Cache::get($cacheKey); $pending['source']['expiresAt']=time()-1; Cache::put($cacheKey,$pending,60);
        $reject($purpose,$code,$purpose===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_INVALID':'SESSION_LINK_INVALID');
        $code=$service->issue($purpose,$source); $cacheKey=$key($purpose,$code);
        $pending=Cache::get($cacheKey); $pending['expiresAt']=time()-1; Cache::put($cacheKey,$pending,60);
        $reject($purpose,$code,$purpose===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_EXPIRED':'SESSION_LINK_EXPIRED');
        $code=$service->issue($purpose,$source); $key($purpose,$code); $auth->removeAllSession();
        $reject($purpose,$code,$purpose===SessionAuthorizationCode::APP ? 'CLIENT_AUTH_INVALID':'SESSION_LINK_INVALID');
    }
    $source=$session(); $code=$service->issue(SessionAuthorizationCode::BROWSER,$source); $key(SessionAuthorizationCode::BROWSER,$code);
    $recipient=$service->exchange(SessionAuthorizationCode::BROWSER,$code);
    $browser=(new AuthService($recipient))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $auth->removeCurrentSession($source);
    $assert(AuthService::decryptAuthData($browser)!==false,'Successful destination session survives source logout');
    $original=config('v2board.app_url');
    try {
        config(['v2board.app_url'=>'https://user@fastdog.ws']);
        try { app(App\Services\BrowserLoginLink::class)->create(Illuminate\Http\Request::create('/'),$browser); throw new RuntimeException('Userinfo accepted'); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===503,'Reject credential-bearing website origin'); }
    } finally { config(['v2board.app_url'=>$original]); }
    echo "Session authorization: $checks checks passed\n";
} finally {
    foreach ($keys as $cacheKey) Cache::forget($cacheKey);
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
}
