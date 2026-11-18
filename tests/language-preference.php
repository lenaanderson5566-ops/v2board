<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$call = function ($method, $path, $body = [], $token = null) use ($kernel) {
    $request = Illuminate\Http\Request::create('/api/'.$path, $method, $body);
    $request->headers->set('Accept', 'application/json');
    $request->headers->set('Accept-Language', 'en-US');
    $request->headers->set('Content-Language', 'en-US');
    if ($token) $request->headers->set('Authorization', 'Bearer '.$token);
    return $kernel->handle($request);
};
$login = fn($body) => $call('POST', 'v1/passport/auth/login', $body);
$original = config('fastai');
config([ 'fastai.email_verify'=>0, 'fastai.invite_force'=>0, 'fastai.stop_register'=>0, 'fastai.email_whitelist_enable'=>0, 'fastai.register_limit_by_ip_enable'=>0, 'fastai.password_limit_enable'=>0]);
Illuminate\Support\Facades\DB::beginTransaction();
$user = null;
try {
    $credentials = ['email'=>'language-'.bin2hex(random_bytes(6)).'@example.com', 'password'=>'language-test-password'];
    $response = $call('POST', 'v10/auth/registrations', $credentials + ['language'=>'ja-JP']);
    $assert($response->getStatusCode() === 201, 'Registration failed: '.$response->getContent());
    $user = App\Models\User::where('email',$credentials['email'])->firstOrFail();
    $assert($user->language === 'ja-JP', 'Registration language missing');
    $token = json_decode($response->getContent(), true)['data']['accessToken'];
    $before = $user->only(['password','token','uuid','balance','plan_id']);
    $assert($login($credentials + ['language'=>'en-US'])->getStatusCode()===200, 'Login failed');
    $assert($user->refresh()->language==='ja-JP', 'Browser default overwrote account preference');
    $assert($login($credentials + ['language'=>'ko-KR','language_selected'=>true])->getStatusCode()===200, 'Explicit login choice failed');
    $assert($user->refresh()->language==='ko-KR', 'Explicit login choice not saved');
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        $assert($call('PATCH','v10/me',['language'=>$language],$token)->getStatusCode()===204, 'Supported language rejected');
        $assert($user->refresh()->language===$language, 'Manual language not persisted');
    }
    foreach (['xx','en',null,[],str_repeat('x',100)] as $invalid) {
        $assert($call('PATCH','v10/me',['language'=>$invalid],$token)->getStatusCode()===422, 'Invalid language accepted');
    }
    $assert($login($credentials+['language'=>'xx'])->getStatusCode()===422, 'Invalid login language accepted');
    $assert($call('POST','v10/auth/registrations',['email'=>'invalid-language@example.com','password'=>'test-password','language'=>'xx'])->getStatusCode()===422, 'Invalid registration language accepted');
    $user->update(['language'=>null]);
    $assert($login($credentials)->getStatusCode()===200 && $user->refresh()->language===null, 'Legacy login must remain compatible');
    $assert($login($credentials+['language'=>'vi-VN'])->getStatusCode()===200 && $user->refresh()->language==='vi-VN', 'First login must initialize missing preference');
    $wrong = $credentials; $wrong['password']='wrong-test-password';
    $login($wrong+['language'=>'ru-RU','language_selected'=>true]);
    $assert($user->refresh()->language==='vi-VN','Failed authentication changed preference');
    $info = json_decode($call('GET','v10/me',[],$token)->getContent(),true)['data'];
    $assert($info['language']==='vi-VN', 'Account API did not return preference');
    $assert($user->only(array_keys($before))===$before,'Preference changed account credentials or subscription');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false, 'Language change revoked session');
    echo "Language preferences: $checks checks passed\n";
} finally {
    if ($user) (new App\Services\AuthService($user))->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
    config(['fastai'=>$original]);
}
