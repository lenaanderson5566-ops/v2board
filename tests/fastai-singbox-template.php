<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$user = ['uuid'=>'00000000-0000-4000-8000-000000000001', 'u'=>0, 'd'=>0, 'transfer_enable'=>1000, 'expired_at'=>time()+86400];
$nodes = [
    ['id'=>1,'name'=>'Test node','type'=>'v2box','protocol'=>'shadowsocks','cipher'=>'aes-128-gcm','host'=>'node.example','port'=>443],
    ['id'=>2,'name'=>'Naive node','type'=>'v2box','protocol'=>'naive','host'=>'naive.example','port'=>443],
];
$template = new App\Services\FastaiSingboxConfig($user,$nodes);
$config = json_decode($template->handle()->getContent(),true,512,JSON_THROW_ON_ERROR);
$assert(count($template->nodes())===2, 'Template includes all supported server protocols');
$assert($config['inbounds']===[], 'Runtime owns listeners');
$assert($config['route']['final']==='节点选择', 'Independent app route template');
$assert(!isset($config['experimental']['clash_api']), 'No public controller in app template');
$assert(in_array($template->nodes()[0]['proxyName'], array_column($config['outbounds'],'tag'), true), 'Metadata and outbound identity match');
if (isset($argv[1])) file_put_contents($argv[1],json_encode(['fastai-core'=>'sing-box','configuration'=>$config],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT));
$assert(in_array('naive',array_column($config['outbounds'],'type'),true),'Naive is exported without client capability parameters');
$path = resource_path('rules/custom.fastai.sing-box.json');
$original = is_file($path) ? file_get_contents($path) : null;
try {
    $config['outbounds'] = array_slice($config['outbounds'],0,4);
    $config['route']['rule_set'] = [['type'=>'remote','tag'=>'remote','url'=>'https://example.com/rules.srs']];
    file_put_contents($path,json_encode($config));
    $rejected = false;
    try {(new App\Services\FastaiSingboxConfig($user,$nodes))->handle();}
    catch (RuntimeException $e) {$rejected=true;}
    $assert($rejected,'App template rejects online rule downloads');
} finally {
    if ($original===null) unlink($path); else file_put_contents($path,$original);
}
echo "FastAI sing-box template: {$checks} checks passed\n";
