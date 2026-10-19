<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
$controller=new App\Services\Actions\Client\ClientActions;
$method=new ReflectionMethod($controller,'buildUnavailableServers'); $method->setAccessible(true);
$copy=require resource_path('client/copy.php');
$checks=0;
$serverCatalogs=[];
foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
    $serverCatalogs[$language]=json_decode(file_get_contents(resource_path('lang/'.$language.'.json')), true, 512, JSON_THROW_ON_ERROR);
}
foreach ($serverCatalogs as $language=>$catalog) {
    foreach ($serverCatalogs['en-US'] as $key=>$english) {
        if (empty($catalog[$key])) throw new RuntimeException('Missing server translation '.$language.' '.$key);
        preg_match_all('/:\w+/', $english, $expected);
        preg_match_all('/:\w+/', $catalog[$key], $actual);
        sort($expected[0]); sort($actual[0]);
        if ($expected[0] !== $actual[0]) throw new RuntimeException('Invalid server placeholders '.$language.' '.$key);
        $checks++;
    }
}
// Audit actual call sites, so complete-but-outdated catalogs cannot hide new missing messages.
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path())) as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'php' || str_contains(str_replace('\\','/',$file->getPathname()), '/Admin/')) continue;
    $tokens=token_get_all(file_get_contents($file->getPathname()));
    foreach ($tokens as $index=>$token) {
        if (!is_array($token) || $token[0] !== T_STRING || $token[1] !== '__') continue;
        $following=[];
        for ($next=$index+1; $next<count($tokens) && count($following)<2; $next++) {
            if (is_array($tokens[$next]) && in_array($tokens[$next][0],[T_WHITESPACE,T_COMMENT,T_DOC_COMMENT],true)) continue;
            $following[]=$tokens[$next];
        }
        if (($following[0] ?? null) !== '(' || !is_array($following[1] ?? null) || $following[1][0] !== T_CONSTANT_ENCAPSED_STRING) continue;
        $literal=$following[1][1];
        $key=$literal[0] === "'" ? str_replace(["\\'",'\\\\'],["'",'\\'],substr($literal,1,-1)) : stripcslashes(substr($literal,1,-1));
        if (!isset($serverCatalogs['en-US'][$key])) throw new RuntimeException('Unregistered server message '.$file->getFilename().':'.$token[2].' '.$key);
        $checks++;
    }
}
// The frontend owns browser guidance and localization; global interception must stay removed.
if (str_contains(file_get_contents(app_path('Http/Kernel.php')),'UAfilter::class')) throw new RuntimeException('Obsolete browser intercept restored');
$checks++;
foreach (['client/copy.php', 'lang/telegram.php', 'lang/mfa.php'] as $resource) {
    $catalog = require resource_path($resource);
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        if (!isset($catalog[$language])) throw new RuntimeException('Missing language '.$language.' '.$resource);
        foreach ($catalog['en-US'] as $key => $english) {
            $translated = $catalog[$language][$key] ?? null;
            if (!$translated) throw new RuntimeException('Missing translation '.$language.' '.$resource.' '.$key);
            preg_match_all('/:\w+|%d/', json_encode($english), $expected);
            preg_match_all('/:\w+|%d/', json_encode($translated), $actual);
            sort($expected[0]); sort($actual[0]);
            if ($expected[0] !== $actual[0]) throw new RuntimeException('Invalid placeholders '.$language.' '.$resource.' '.$key);
            $checks++;
        }
    }
}
foreach ($copy as $locale=>$words) {
    app()->setLocale($locale);
    foreach (['no_plan','expired','user_unavailable','banned','client_disabled','client_version_too_low'] as $reason) {
        $nodes=$method->invoke($controller,$reason);
        if (count($nodes)!==1 || $nodes[0]['name']!=='⚠ '.$words[$reason]) throw new RuntimeException('Wrong client language '.$locale.' '.$reason);
        $checks++;
    }
}
$date = new ReflectionMethod($controller, 'subscriptionDate'); $date->setAccessible(true);
$timestamp = strtotime('2026-01-01 00:00:00 UTC');
foreach ([
    ['Asia/Shanghai', '2026-01-01 08:00 GMT+8'],
    ['UTC', '2026-01-01 00:00 GMT'],
    ['Asia/Kathmandu', '2026-01-01 05:45 GMT+5:45'],
    ['America/New_York', '2025-12-31 19:00 GMT-5'],
] as [$zone, $expected]) {
    config(['app.timezone'=>$zone]);
    if ($date->invoke($controller, $timestamp) !== $expected) throw new RuntimeException('Incorrect compact timezone '.$zone);
    $checks++;
}
config(['app.timezone'=>'America/New_York']);
if ($date->invoke($controller, strtotime('2026-07-01 00:00:00 UTC')) !== '2026-06-30 20:00 GMT-4') throw new RuntimeException('Incorrect daylight saving offset');
$checks++;
echo "PASS: {$checks} client language checks\n";
