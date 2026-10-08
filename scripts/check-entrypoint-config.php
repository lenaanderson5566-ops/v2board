<?php
if (PHP_SAPI!=='cli') exit(1);
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$file=storage_path('app/fastai-entrypoint.seed');
$value=config('fastai.entrypoint_signing_seed');
$decoded=is_string($value) ? base64_decode($value,true) : false;
echo json_encode([
    'phpVersion'=>PHP_VERSION,'sapi'=>PHP_SAPI,
    'sodiumAvailable'=>function_exists('sodium_crypto_sign_seed_keypair'),
    'curlAvailable'=>extension_loaded('curl'),
    'seedFileExists'=>is_file($file),'seedFileReadable'=>is_readable($file),
    'signingSeedValid'=>is_string($decoded) && strlen($decoded)===32,
    'configurationCached'=>$app->configurationIsCached(),
],JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL;
