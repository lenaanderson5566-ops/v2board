<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($ok, $message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$call = function ($path, $body = null, $token = null) use ($kernel) {
    $request = Illuminate\Http\Request::create('/api/v1/'.$path, $body === null ? 'GET' : 'POST', $body ?? []);
    $request->headers->set('Accept', 'application/json');
    $request->headers->set('Content-Language', 'en-US');
    if ($token) $request->headers->set('Authorization', $token);
    return $kernel->handle($request);
};
$original = config('v2board');
config(['v2board.recaptcha_enable'=>0, 'v2board.email_verify'=>0, 'v2board.invite_force'=>0, 'v2board.stop_register'=>0, 'v2board.email_whitelist_enable'=>0, 'v2board.register_limit_by_ip_enable'=>0, 'v2board.password_limit_enable'=>0]);
Illuminate\Support\Facades\DB::beginTransaction();
$user = null;
try {
    $credentials = ['email'=>'language-'.bin2hex(random_bytes(6)).'@example.com', 'password'=>'language-test-password'];
    $response = $call('passport/auth/register', $credentials + ['language'=>'ja-JP']);
    $assert($response->getStatusCode() === 200, 'Registration failed: '.$response->getContent());
    $user = App\Models\User::where('email',$credentials['email'])->firstOrFail();
    $assert($user->language === 'ja-JP', 'Registration language missing');
    $token = json_decode($response->getContent(), true)['data']['auth_data'];
    $before = $user->only(['password','token','uuid','balance','plan_id']);
    $assert($call('passport/auth/login', $credentials + ['language'=>'en-US'])->getStatusCode()===200, 'Login failed');
    $assert($user->refresh()->language==='ja-JP', 'Browser default overwrote account preference');
    $assert($call('passport/auth/login', $credentials + ['language'=>'ko-KR','language_selected'=>true])->getStatusCode()===200, 'Explicit login choice failed');
    $assert($user->refresh()->language==='ko-KR', 'Explicit login choice not saved');
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        $assert($call('user/update',['language'=>$language],$token)->getStatusCode()===200, 'Supported language rejected');
        $assert($user->refresh()->language===$language, 'Manual language not persisted');
    }
    foreach (['xx','en',null,[],str_repeat('x',100)] as $invalid) {
        $assert($call('user/update',['language'=>$invalid],$token)->getStatusCode()===422, 'Invalid language accepted');
    }
    $assert($call('passport/auth/login',$credentials+['language'=>'xx'])->getStatusCode()===422, 'Invalid login language accepted');
    $assert($call('passport/auth/register',['email'=>'invalid-language@example.com','password'=>'test-password','language'=>'xx'])->getStatusCode()===422, 'Invalid registration language accepted');
    $user->update(['language'=>null]);
    $assert($call('passport/auth/login',$credentials)->getStatusCode()===200 && $user->refresh()->language===null, 'Legacy login must remain compatible');
    $assert($call('passport/auth/login',$credentials+['language'=>'vi-VN'])->getStatusCode()===200 && $user->refresh()->language==='vi-VN', 'First login must initialize missing preference');
    $wrong = $credentials; $wrong['password']='wrong-test-password';
    $call('passport/auth/login',$wrong+['language'=>'ru-RU','language_selected'=>true]);
    $assert($user->refresh()->language==='vi-VN','Failed authentication changed preference');
    $info = json_decode($call('user/info', null, $token)->getContent(),true)['data'];
    $assert($info['language']==='vi-VN', 'Account API did not return preference');
    $assert($user->only(array_keys($before))===$before,'Preference changed account credentials or subscription');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Language change revoked session');
    echo "Language preferences: $checks checks passed\n";
} finally {
    if ($user) (new App\Services\AuthService($user))->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    config(['v2board'=>$original]);
}
