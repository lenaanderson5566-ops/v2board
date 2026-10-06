<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$controller=new App\Services\Actions\Client\ClientActions;
$method=new ReflectionMethod($controller,'buildUnavailableServers'); $method->setAccessible(true);
$copy=require resource_path('client/copy.php');
$checks=0;
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
