<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$original = config('v2board');
$directory = sys_get_temp_dir() . '/frontend-runtime-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
try {
    config(['v2board.secure_path' => 'test-admin', 'v2board.smtp_password' => 'must-not-be-exported']);
    $assert(App\Services\BrowserAccess::policies() === App\Services\BrowserAccess::DEFAULTS, 'Conservative defaults, unknown apps allowed');
    foreach (['allow','prompt','guide','invalid'] as $policy) {
        config(['v2board.browser_policy_wechat'=>$policy]);
        $assert(App\Services\BrowserAccess::policies()['wechat']===($policy==='invalid'?'guide':$policy), 'Policy validation and fallback');
    }
    config(['v2board.browser_policy_wechat'=>'prompt']);
    $rules=App\Http\Requests\Admin\ConfigSave::allRules();
    foreach (array_keys(App\Services\BrowserAccess::DEFAULTS) as $browser) {
        $key='browser_policy_'.$browser;
        foreach (['allow','prompt','guide','invalid','',null] as $value) $assert(validator([$key=>$value],[$key=>$rules[$key]])->passes()===in_array($value,['allow','prompt','guide'],true),'Browser policy accepts only enum: '.$key.' '.json_encode($value));
    }
    foreach ([['Mozilla/5.0 (Linux; Android 14; wv) Chrome/123.0 MicroMessenger/8','chrome',123,'android','wechat'],['Mozilla/5.0 (iPhone) Version/17.2 Safari/605.1 QQ/8','safari',17,'ios','qq'],['Mozilla/5.0 Chrome/120.0 Edg/121.1','edge',121,'unknown','none'],['Weibo','unknown',null,'unknown','weibo'],['Instagram','unknown',null,'unknown','other'],[str_repeat('x',1024).' MicroMessenger','unknown',null,'unknown','none']] as [$ua,$browser,$major,$os,$embedded]) {
        $assert(App\Services\BrowserAccess::classify($ua)===['browser'=>$browser,'browser_major'=>$major,'os'=>$os,'embedded'=>$embedded],'Bounded UA classification: '.$browser.' '.$embedded);
    }
    foreach (['XiaoHongShu'=>'xiaohongshu','Aweme'=>'douyin','BiliApp'=>'bilibili','AlipayClient'=>'alipay','DingTalk'=>'dingtalk','MicroMessenger wxwork'=>'wecom'] as $ua=>$expected) {
        $assert(App\Services\BrowserAccess::classify($ua)['embedded']===$expected,'Application UA: '.$expected);
        $assert(App\Services\BrowserAccess::policies()[$expected]==='allow','New platforms default allow');
    }
    $user = App\Support\FrontendRuntime::config('user', false);
    $admin = App\Support\FrontendRuntime::config('admin');
    config(['v2board.landing_style' => 'minimal']);
    $assert(App\Support\FrontendRuntime::config('user', true)['landingStyle'] === 'minimal', 'Minimal landing selected');
    config(['v2board.landing_style' => 'unknown']);
    $assert(App\Support\FrontendRuntime::config('user', true)['landingStyle'] === 'original', 'Unknown landing style falls back to original');
    config(['v2board.landing_style' => 'original']);
    $assert($user['browserPolicies']['wechat']==='prompt','Policies exported with runtime without a new request');
    $assert($user['adminPath'] === '' && $user['opsPath'] === '', 'User configuration hides administrative paths');
    $assert($admin['adminPath'] === 'test-admin', 'Admin path preserved');
    $assert($user['landing'] === false && !array_key_exists('landing', $admin), 'Server and standalone landing selection');
    $assert(array_key_exists('passkeyEnabled',$user) && !array_key_exists('recaptchaSiteKey',$user) && !array_key_exists('recaptchaSiteKey',$admin), 'Runtime exports Passkey feature flag without retired CAPTCHA settings');
    $assert(!str_contains(json_encode($user), 'must-not-be-exported') && !str_contains(json_encode($admin), 'must-not-be-exported'), 'No backend secrets exported');
    $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => 'https://api.example.test', '--output' => $directory, '--mode' => 'user']) === 0, 'Public user export');
    $assert(is_file($directory . '/user-config.json') && !is_file($directory . '/admin-config.json'), 'User deployment excludes admin config');
    $exported = json_decode(file_get_contents($directory . '/user-config.json'), true);
    $assert($exported['apiBaseUrl'] === 'https://api.example.test' && $exported['mode'] === 'user', 'Backend origin and entry mode exported');
    $assert(!array_key_exists('landing', $exported), 'Standalone account path can select account page');
    foreach (['http://remote.example', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?token=x'] as $origin) {
        $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => $origin, '--output' => $directory]) === 1, 'Unsafe API origin rejected');
    }
    $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => 'https://api.example.test', '--output' => $directory, '--mode' => 'admin']) === 0, 'Public admin export');
    $assert(json_decode(file_get_contents($directory . '/admin-config.json'), true)['adminPath'] === 'test-admin', 'Admin export preserves API routing');
    echo "Frontend runtime: {$checks} checks passed\n";
} finally {
    config(['v2board' => $original]);
    foreach (['user-config.json', 'admin-config.json'] as $file) if (is_file($directory . '/' . $file)) unlink($directory . '/' . $file);
    rmdir($directory);
}
