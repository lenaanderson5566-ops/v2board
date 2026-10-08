<?php
namespace App\Services {
    function dns_get_record($host,$type) { return array_map(fn($ip)=>['ip'=>$ip],$GLOBALS['entrypointTestIps']); }
}
namespace {
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$original=config('v2board');$seed=config('fastai.entrypoint_signing_seed');
$service=app(App\Services\FastaiEntrypoints::class);
try {
    config(['v2board.app_url'=>'https://fastdog.ws','v2board.fastai_entrypoints'=>[],'fastai.entrypoint_signing_seed'=>base64_encode(random_bytes(32))]);
    $GLOBALS['entrypointTestIps']=['1.1.1.1'];
    $envelope=$service->envelope();
    Illuminate\Support\Facades\Http::fake(['*'=>Illuminate\Support\Facades\Http::response(['data'=>$envelope],200)]);
    $checked=$service->check('https://probe.example');
    $assert($checked['origin']==='https://probe.example' && isset($checked['checkedAt'],$checked['durationMs']),'Compatible HTTP service check completes');
    $recorded=Illuminate\Support\Facades\Http::recorded();
    $assert($recorded->count()===1 && $recorded[0][0]->url()==='https://probe.example/api/v10/public/fastai/entrypoints','Uses signed public endpoint');
    $service->requireVerified([['origin'=>'https://probe.example','enabled'=>true,'priority'=>1]]);
    $assert(true,'Successful check permits publication');
    $GLOBALS['entrypointTestIps']=['127.0.0.1'];
    try { $service->check('https://private.example'); throw new RuntimeException('Private probe accepted'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===422,'Private destination denied'); }
    echo "FastAI entrypoint checks: $checks checks passed\n";
} finally {
    Illuminate\Support\Facades\Cache::forget('FASTAI_ENTRYPOINT_VERIFIED:'.hash('sha256','https://probe.example:'.$service->publicKey()));
    config(['v2board'=>$original,'fastai.entrypoint_signing_seed'=>$seed]);
    unset($GLOBALS['entrypointTestIps']);
}
}
