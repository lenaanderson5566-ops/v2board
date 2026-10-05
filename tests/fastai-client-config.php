<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$call = function ($path, $token = null, $method = 'GET') use ($app) {
    $request = Illuminate\Http\Request::create($path, $method, [], [], [], [
        'HTTP_ACCEPT_LANGUAGE'=>'en-US', 'HTTP_USER_AGENT'=>'fastai/0.8.99',
    ]);
    if ($token) $request->headers->set('Authorization', 'Bearer '.$token);
    $app->instance('request', $request);
    return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
};
$path = '/api/v10/me/client-config?clientVersion=0.8.99&platform=windows';
$auth = null;
Illuminate\Support\Facades\DB::beginTransaction();
try {
    $user = App\Models\User::create([
        'email'=>Illuminate\Support\Str::uuid().'@example.com',
        'password'=>password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'uuid'=>(string)Illuminate\Support\Str::uuid(), 'token'=>Illuminate\Support\Str::random(32),
        'plan_id'=>1, 'group_id'=>1, 'transfer_enable'=>1073741824, 'expired_at'=>time()+86400,
    ]);
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    App\Models\ClientStrategy::whereIn('client_type', ['meta','flclash'])->update(['is_enabled'=>1, 'min_version'=>null]);
    $assert($call($path)->getStatusCode()===401, 'Missing session');
    $assert($call($path.'&accessToken=query-only')->getStatusCode()===401, 'Query credentials rejected');
    $assert($call('/api/v10/me/client-config', $token)->getStatusCode()===422, 'Version and platform required');
    $assert($call('/api/v10/me/client-config?clientVersion=invalid&platform=windows', $token)->getStatusCode()===422, 'Version validation');
    $assert($call('/api/v10/me/client-config?clientVersion=0.8.99&platform=invalid', $token)->getStatusCode()===422, 'Platform validation');
    $response = $call($path.'&user[id]=0&token=ignored', $token);
    $assert($response->getStatusCode()===200, 'Authenticated config ignores query identity: '.$response->getStatusCode().' '.(json_decode($response->getContent(), true)['code'] ?? ''));
    $assert(str_contains($response->headers->get('Content-Type'), 'application/yaml'), 'Native YAML content type');
    $assert(str_contains($response->getContent(), 'proxy-groups:'), 'Shared config generator');
    $assert($response->headers->get('Content-Language')==='en-US', 'Language negotiation');
    $assert(str_contains($response->headers->get('Cache-Control'), 'no-store'), 'Private config is not cached');
    $assert(!$response->headers->has('Location'), 'No subscription redirect');
    $logged = App\Models\Log::where('uri', '/api/v10/me/client-config')->latest('id')->first();
    $assert($logged && $logged->getRawOriginal('data')==='[]', 'Config request log omits parameters and credentials');
    $logContext=json_decode($logged->getRawOriginal('context'),true);
    $assert($logged->title==='Client configuration request' && $logContext['userId']===$user->id && $logContext['clientVersion']==='0.8.99' && $logContext['platform']==='windows', 'Config request records identity and client metadata');
    $assert($logContext['outcome']==='success' && $logContext['status']===200 && isset($logContext['requestId'],$logContext['durationMs']), 'Config request records result and timing');
    $assert($call($path, $token, 'HEAD')->getStatusCode()===200, 'HEAD supported');
    $legacy = $call('/api/v10/subscriptions/'.$user->token.'?format=flclash');
    $assert($legacy->getStatusCode()===200 && str_contains($legacy->getContent(), 'proxy-groups:'), 'Token subscriptions remain compatible');
    $user->update(['plan_id'=>null, 'transfer_enable'=>0, 'credit_balance'=>0]);
    $denied = $call($path, $token);
    $problem = json_decode($denied->getContent(), true);
    $assert($denied->getStatusCode()===403 && $problem['code']==='SUBSCRIPTION_UNAVAILABLE', 'Unpaid account denied without placeholder config');
    $assert(str_contains($denied->headers->get('Content-Type'), 'application/problem+json') && isset($problem['requestId']), 'Structured error contract');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Entitlement denial keeps session');
    $failedLog=App\Models\Log::where('title','Client configuration request')->latest('id')->first();
    $failedContext=json_decode($failedLog->getRawOriginal('context'),true);
    $assert($failedContext['outcome']==='failed' && $failedContext['code']==='SUBSCRIPTION_UNAVAILABLE', 'Config denial is logged with its stable reason');
    $user->update(['plan_id'=>1, 'transfer_enable'=>1073741824, 'expired_at'=>time()-1]);
    $assert($call($path, $token)->getStatusCode()===403, 'Expired subscription denied');
    $user->update(['credit_balance'=>1073741824]);
    $assert($call($path, $token)->getStatusCode()===200, 'Independent traffic credit remains available');
    App\Models\ClientStrategy::updateOrCreate(['client_type'=>'flclash'], ['is_enabled'=>1, 'min_version'=>'9.0.0']);
    $low = $call($path, $token);
    $assert($low->getStatusCode()===409 && json_decode($low->getContent(), true)['code']==='CLIENT_VERSION_TOO_LOW', 'Explicit client version policy');
    App\Models\ClientStrategy::where('client_type', 'flclash')->update(['is_enabled'=>0]);
    $disabled = $call($path, $token);
    $assert($disabled->getStatusCode()===403 && json_decode($disabled->getContent(), true)['code']==='CLIENT_DISABLED', 'Disabled client policy');
    $user->update(['banned'=>1]);
    $assert($call($path, $token)->getStatusCode()===403, 'Banned session denied');
    $user->update(['banned'=>0]);
    $auth->removeAllSession();
    $assert($call($path, $token)->getStatusCode()===401, 'Revoked session denied');
    echo "fastai config: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
}
