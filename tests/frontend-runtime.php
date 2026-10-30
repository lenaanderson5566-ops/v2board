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
    foreach (['wechat','qq','weibo','wecom'] as $browser) $assert(App\Services\BrowserAccess::policies()[$browser]==='guide', 'Primary application defaults to guidance: '.$browser);
    foreach (['wechat','wecom'] as $browser) foreach (['allow','prompt','guide','invalid'] as $policy) {
        config(['v2board.browser_policy_'.$browser=>$policy]);
        $assert(App\Services\BrowserAccess::policies()[$browser]===($policy==='invalid'?'guide':$policy), 'Explicit policy is preserved with safe fallback: '.$browser);
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
        $assert(App\Services\BrowserAccess::policies()[$expected]===($expected==='wecom'?'guide':'allow'),'Platform default follows its configured entry policy');
    }
    foreach ([['MicroMessenger/8 wxwork/4','wecom'],['DingTalk MicroMessenger wxwork/4','wecom'],['XiaoHongShu/9 MicroMessenger/8','xiaohongshu'],['MICROMESSENGER/8','wechat'],['Mobile QQ/9.0 MQQBrowser/15.0','qq'],['Mozilla Android;wv) Chrome/130','other'],['Mozilla Android;  wv; Chrome/130','other'],['[FB_IAB/FB4A;]','other'],['Instagram 300','other'],['MQQBrowser/15.0','none'],['NotQQ/9.0','none'],['NotInstagram/300','none'],['Mozilla iPhone AppleWebKit/605.1 Version/18.0 Mobile Safari/605.1','none'],['Mozilla Android Chrome/130 Mobile Safari/537.36','none'],[str_repeat('x',1024).' MicroMessenger/8','none']] as [$ua,$expected]) {
        $classified=App\Services\BrowserAccess::classify($ua);
        $assert($classified['embedded']===$expected,'Embedded attribution preserves marker boundaries and precedence: '.$expected);
        $sqlCategory=Illuminate\Support\Facades\DB::selectOne('SELECT '.App\Services\BrowserAccess::logCategorySql().' AS category FROM (SELECT ? AS user_agent) AS sample',[$ua])->category;
        $expectedCategory=$expected==='none' ? $classified['browser'] : ($expected==='other' ? 'embedded_other' : $expected);
        $assert($sqlCategory===$expectedCategory,'Existing-log category agrees with bounded attribution: '.$expectedCategory);
    }
    foreach ([['Chrome/120.0 360SE','360',null],['Chrome/120.0 360EE','360',null],['Chrome/120.0 SE 2.X MetaSr 1.0','sogou',null],['Chrome/120.0 SogouMobileBrowser/6.2','sogou',6],['Chrome/120.0 QQBrowser/12.1','qqbrowser',12],['Chrome/120.0 UCBrowser/17.2','uc',17],['Chrome/117.0 SamsungBrowser/24.0','samsung',24],['Chrome/120.0','chrome',120],['EdgiOS/120.0','edge',120]] as [$ua,$family,$major]) {
        $classified=App\Services\BrowserAccess::classify($ua);
        $assert($classified['browser']===$family && $classified['browser_major']===$major,'Browser family and own version: '.$family);
        $sqlFamily=Illuminate\Support\Facades\DB::selectOne('SELECT '.App\Services\BrowserAccess::logCategorySql().' AS category FROM (SELECT ? AS user_agent) AS sample',[$ua])->category;
        $assert($sqlFamily===$family,'Existing-log SQL agrees with browser category: '.$family);
    }
    $user = App\Support\FrontendRuntime::config('user', false);
    $admin = App\Support\FrontendRuntime::config('admin');
    config(['v2board.landing_style' => 'minimal']);
    $assert(App\Support\FrontendRuntime::config('user', true)['landingStyle'] === 'minimal', 'Minimal landing selected');
    config(['v2board.landing_style' => 'unknown']);
    $assert(App\Support\FrontendRuntime::config('user', true)['landingStyle'] === 'original', 'Unknown landing style falls back to original');
    config(['v2board.landing_style' => 'original']);
    $assert($user['browserPolicies']['wechat']==='prompt','Policies exported with runtime without a new request');
    $assert($user['browserPolicies']['wecom']==='guide','Unset or invalid WeCom policy exports the guidance default');
    config(['v2board.browser_policy_wecom'=>'allow']);
    $assert(App\Support\FrontendRuntime::config('user', false)['browserPolicies']['wecom']==='allow','Existing explicit WeCom allow setting is not overwritten');
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
