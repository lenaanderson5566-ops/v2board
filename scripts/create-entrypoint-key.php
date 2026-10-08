<?php
if (PHP_SAPI!=='cli') exit(1);
if (!function_exists('sodium_crypto_sign_seed_keypair')) throw new RuntimeException('The PHP sodium extension is required.');
$path=__DIR__.'/../storage/app/fastai-entrypoint.seed';
if (!is_dir(dirname($path)) && !mkdir(dirname($path),0700,true)) throw new RuntimeException('Cannot create the private storage directory.');
if (!is_file($path)) {
    $file=fopen($path,'x');
    if (!$file) throw new RuntimeException('Cannot create the signing seed file.');
    chmod($path,0600);
    fwrite($file,base64_encode(random_bytes(32)));
    fclose($file);
}
$seed=base64_decode(trim(file_get_contents($path)),true);
if ($seed===false || strlen($seed)!==32) throw new RuntimeException('The existing seed file is invalid; it was not replaced.');
echo 'FASTAI_ENTRYPOINT_PUBLIC_KEY='.base64_encode(sodium_crypto_sign_publickey(sodium_crypto_sign_seed_keypair($seed))).PHP_EOL;
