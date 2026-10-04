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
echo "PASS: {$checks} client language checks\n";
