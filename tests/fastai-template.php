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
            'proxies'=>[['name'=>'剩余流量: 10GB','type'=>'direct'],['name'=>'独立流量: 20GB','type'=>'direct'],['name'=>'可用重置: 2 次','type'=>'direct']],
            'geo-auto-update'=>true,
            'geox-url'=>['geoip'=>'https://example.com/geoip.dat'],
            'geo-update-interval'=>1,
            'proxy-groups'=>[['name'=>$index===0 ? 'Native only' : 'Public only', 'type'=>'select', 'proxies'=>['剩余流量: 10GB', '/.*/']]],
            'rules'=>['MATCH,'.($index===0 ? 'Native only' : 'Public only')],
        ]));
    }
    $native = Symfony\Component\Yaml\Yaml::parse((new App\Services\FastaiConfig($user, $nodes))->handle());
    $assert(!in_array('剩余流量: 10GB', array_column($native['proxies'], 'name')), 'Custom native template cannot inject subscription metadata nodes');
    $public = Symfony\Component\Yaml\Yaml::parse((new App\Protocols\FlClash($user, $nodes))->handle());
    $assert($native['proxy-groups'][0]['name']==='Native only', 'FastAI custom template selected');
    $assert($public['proxy-groups'][0]['name']==='Public only', 'Public custom template selected independently');
    $assert(array_column($native['proxies'], 'name')===['Real node'], 'Shared protocol node generator retained');
    $assert($native['proxy-groups'][0]['proxies']===['Real node'], 'Native group populated with actual node');
    $assert($native['geo-auto-update']===false && !isset($native['geox-url'], $native['geo-update-interval']), 'Native custom template cannot enable Geo downloads');
    $assert($public['geo-auto-update']===true && isset($public['geox-url']), 'Public Geo configuration is unaffected');
    $template = Symfony\Component\Yaml\Yaml::parseFile($paths[0]);
    $template['rule-providers'] = ['remote'=>['type'=>'http', 'url'=>'https://example.com/rules']];
    file_put_contents($paths[0], Symfony\Component\Yaml\Yaml::dump($template));
    $rejected = false;
    try { (new App\Services\FastaiConfig($user, $nodes))->handle(); }
    catch (RuntimeException $error) { $rejected = true; }
    $assert($rejected, 'Remote rule providers are rejected instead of downloading or silently dropping rules');
} finally {
    foreach ($paths as $index => $path) {
        if ($original[$index]===null) unlink($path);
        else file_put_contents($path, $original[$index]);
    }
}
echo "fastai template: {$checks} checks passed\n";
