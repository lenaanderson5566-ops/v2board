<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$call = function ($path, $body = [], $token = null, $method = 'GET') use ($app) {
    $request = Illuminate\Http\Request::create('/api/v10/'.$path, $method, $body);
    $request->headers->set('Accept', 'application/json');
    if ($token) $request->headers->set('Authorization', 'Bearer '.$token);
    $app->instance('request', $request);
    return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
};
$release = ['platform'=>'windows', 'architecture'=>'x64', 'channel'=>'stable', 'latestVersion'=>'1.2.0', 'latestBuild'=>2026100602,
    'minimumVersion'=>'1.0.0', 'downloadUrl'=>'https://fastdog.ws/download/FastAI.exe', 'sha256'=>str_repeat('a',64),
    'releaseNotes'=>'Release', 'publishedAt'=>'2026-10-06T00:00:00Z'];
$original = config('v2board');
$auth = null;
Illuminate\Support\Facades\DB::beginTransaction();
try {
    config(['v2board.fastai_releases'=>[$release], 'v2board.app_url'=>'https://fastdog.ws']);
    $response = $call('public/fastai/releases/latest?platform=windows&architecture=x64');
    $assert($response->getStatusCode()===200, 'Public release endpoint');
    $data = json_decode($response->getContent(), true)['data'];
    $assert($data['latestVersion']==='1.2.0' && $data['latestBuild']===2026100602 && $data['minimumVersion']==='1.0.0', 'Semantic release contract');
    $assert($data['sha256']===$release['sha256'], 'Release digest');
    $assert($call('public/fastai/releases/latest?platform=android&architecture=arm64')->getStatusCode()===404, 'No cross-platform installer fallback');
    $assert($call('public/fastai/releases/latest?platform=windows')->getStatusCode()===422, 'Architecture required');
    foreach ([['downloadUrl'=>'http://fastdog.ws/update.exe'], ['minimumVersion'=>'9.0.0'], ['sha256'=>'wrong']] as $patch) {
        try { App\Services\FastaiReleaseService::validateCatalog([array_merge($release,$patch)]); throw new RuntimeException('Invalid release accepted'); }
        catch (Illuminate\Validation\ValidationException $e) { $checks++; }
    }
    $service = new App\Services\FastaiReleaseService();
    $assert(!$service->supports('0.8.99','windows','x64') && $service->supports('1.0.0','windows','x64'), 'Minimum version policy');
    $assert(!$service->supports('0.8.99','windows',null), 'Legacy native requests still enforce platform minimum');
    $user = App\Models\User::create(['email'=>bin2hex(random_bytes(8)).'@example.com', 'password'=>password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),
        'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid()]);
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $assert($call('me/login-links', ['redirect'=>'dashboard'], null, 'POST')->getStatusCode()===401, 'Login link requires session');
    $response = $call('me/login-links', ['redirect'=>'dashboard'], $token, 'POST');
    $assert($response->getStatusCode()===200, 'Login link creation');
    $url = json_decode($response->getContent(),true)['data'];
    $assert(!str_contains($url,$token) && !parse_url($url,PHP_URL_QUERY), 'No long-lived credentials in URL');
    parse_str(explode('?',parse_url($url,PHP_URL_FRAGMENT),2)[1], $query);
    $code = $query['verify'];
    $assert(strlen($code)===64 && $query['redirect']==='dashboard', 'Cryptographically random one-time code');
    $response = $call('auth/session-exchanges',['verificationToken'=>$code],null,'POST');
    $assert($response->getStatusCode()===200 && json_decode($response->getContent(),true)['data']['tokenType']==='Bearer', 'Browser exchange creates independent session');
    $assert($call('auth/session-exchanges',['verificationToken'=>$code],null,'POST')->getStatusCode()===409, 'Code cannot be replayed');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Web login preserves app session');
    $response = $call('me/login-links',['redirect'=>'dashboard'],$token,'POST');
    parse_str(explode('?',parse_url(json_decode($response->getContent(),true)['data'],PHP_URL_FRAGMENT),2)[1], $query);
    $user->update(['banned'=>1]);
    $assert($call('auth/session-exchanges',['verificationToken'=>$query['verify']],null,'POST')->getStatusCode()===403, 'Ban checked at redemption');
    echo "FastAI releases and login: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    config(['v2board'=>$original]);
    Illuminate\Support\Facades\DB::rollBack();
}
