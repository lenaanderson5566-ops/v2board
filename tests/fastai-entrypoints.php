<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert=function($ok,$label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$original=config('v2board');$seed=config('fastai.entrypoint_signing_seed');
try {
    $catalog=[['origin'=>'https://fastdog.ws','enabled'=>true,'priority'=>2],['origin'=>'https://fastdog66.com','enabled'=>true,'priority'=>1],['origin'=>'https://fastdog.me','enabled'=>false,'priority'=>3]];
    config(['v2board.app_url'=>'https://fastdog.ws','v2board.fastai_entrypoints'=>$catalog,'v2board.fastai_entrypoints_version'=>12,'fastai.entrypoint_signing_seed'=>base64_encode(random_bytes(32))]);
    $service=app(App\Services\FastaiEntrypoints::class);
    $envelope=$service->envelope();$bytes=base64_decode($envelope['payload']);$public=base64_decode($service->publicKey());
    $assert(sodium_crypto_sign_verify_detached(base64_decode($envelope['signature']),$bytes,$public),'Manifest signature');
    $assert(!sodium_crypto_sign_verify_detached(base64_decode($envelope['signature']),$bytes.' ',$public),'Tampered manifest rejected');
    $payload=json_decode($bytes,true);
    $assert($payload['serviceId']===hash('sha256',$public),'Service identity');
    $assert($payload['version']===12 && $payload['expiresAt']- $payload['issuedAt']===604800,'Version and expiry');
    $assert(count($payload['endpoints'])===2 && $payload['endpoints'][0]['origin']==='https://fastdog66.com','Enabled origins ordered');
    foreach (['http://example.com','https://example.com/path','https://user@example.com','https://127.0.0.1','https://example.com:8443','https://example.com?token=x'] as $bad) {
        try { App\Services\FastaiEntrypoints::origin($bad); throw new RuntimeException('Accepted invalid origin'); }
        catch (Illuminate\Validation\ValidationException $error) { $assert(true,'Reject invalid origin'); }
    }
    $assert($service->requestOrigin(Illuminate\Http\Request::create('https://fastdog66.com/api/v10'))==='https://fastdog66.com','Trusted request host');
    $assert($service->requestOrigin(Illuminate\Http\Request::create('https://evil.example/api/v10'))==='https://fastdog.ws','Unknown request host not reflected');
    $assert($service->requestOrigin(Illuminate\Http\Request::create('https://fastdog.me/api/v10'))==='https://fastdog.ws','Disabled request host not reflected');
    try { $service->requireVerified([['origin'=>'https://new.example','enabled'=>true,'priority'=>1]]); throw new RuntimeException('Unchecked origin published'); }
    catch (Illuminate\Validation\ValidationException $error) { $assert(true,'New origin needs verification'); }
    $service->requireVerified([['origin'=>'https://fastdog.ws','enabled'=>true,'priority'=>10]]);
    $assert(true,'Existing active origin can retain or change priority');
    try { App\Services\FastaiEntrypoints::validate([['origin'=>'https://fastdog.ws','enabled'=>true,'priority'=>1],['origin'=>'https://fastdog.ws/','enabled'=>true,'priority'=>2]]); throw new RuntimeException('Duplicate origin'); }
    catch (Illuminate\Validation\ValidationException $error) { $assert(true,'Duplicate normalized origin rejected'); }
    $request=Illuminate\Http\Request::create('https://fastdog.ws/api/v10/public/fastai/entrypoints','GET',[],[],[],['REMOTE_ADDR'=>'192.0.2.'.random_int(2,254)]);
    $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
    $assert($response->getStatusCode()===200 && isset(json_decode($response->getContent(),true)['data']['signature']),'Public signed V10 resource');
    config(['fastai.entrypoint_signing_seed'=>'']);
    $assert($service->publicKey()===null,'Missing signing key fails closed');
    try { $service->envelope(); throw new RuntimeException('Unsigned publication'); } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===503,'No unsigned manifest'); }
    echo "FastAI entrypoints: $checks checks passed\n";
} finally { config(['v2board'=>$original,'fastai.entrypoint_signing_seed'=>$seed]); }
