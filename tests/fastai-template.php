<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$user = ['uuid'=>'test', 'u'=>0, 'd'=>0, 'transfer_enable'=>1000, 'expired_at'=>time()+86400];
$nodes = [['name'=>'Real node', 'type'=>'shadowsocks', 'cipher'=>'aes-128-gcm', 'host'=>'node.example', 'port'=>443]];
$paths = [resource_path('rules/custom.fastai.yaml'), resource_path('rules/custom.clash.yaml')];
$original = array_map(fn ($path) => file_exists($path) ? file_get_contents($path) : null, $paths);
try {
    foreach ($paths as $index => $path) {
        file_put_contents($path, Symfony\Component\Yaml\Yaml::dump([
            'proxy-groups'=>[['name'=>$index===0 ? 'Native only' : 'Public only', 'type'=>'select', 'proxies'=>[]]],
            'rules'=>['MATCH,'.($index===0 ? 'Native only' : 'Public only')],
        ]));
    }
    $native = Symfony\Component\Yaml\Yaml::parse((new App\Services\FastaiConfig($user, $nodes))->handle());
    $public = Symfony\Component\Yaml\Yaml::parse((new App\Protocols\FlClash($user, $nodes))->handle());
    $assert($native['proxy-groups'][0]['name']==='Native only', 'FastAI custom template selected');
    $assert($public['proxy-groups'][0]['name']==='Public only', 'Public custom template selected independently');
    $assert(array_column($native['proxies'], 'name')===['Real node'], 'Shared protocol node generator retained');
    $assert($native['proxy-groups'][0]['proxies']===['Real node'], 'Native group populated with actual node');
} finally {
    foreach ($paths as $index => $path) {
        if ($original[$index]===null) unlink($path);
        else file_put_contents($path, $original[$index]);
    }
}
echo "fastai template: {$checks} checks passed\n";
