<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');

use App\Services\ClientConfigService;
use App\Services\ClientReleaseService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Symfony\Component\Yaml\Yaml;

config(['cache.default' => 'array']);
$checks = 0;
$assert = function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Check failed: '.($checks + 1)); $checks++; };
$nodes = [['name' => 'DIRECT'], ['name' => "HK\n, 1"], ['name' => "HK\n, 1"]];
$names = array_column(ClientConfigService::uniqueNames($nodes, 'name', ['DIRECT']), 'name');
$assert(count(array_unique($names)) === 3 && $names[0] !== 'DIRECT' && !str_contains(implode('', $names), "\n"));
$template = Yaml::parseFile(resource_path('rules/default.clash.yaml'));
$template['proxy-groups'][] = ['name' => 'Empty filter', 'type' => 'select', 'proxies' => ['/NO-MATCH/']];
config(['v2board.app_name' => "Brand: 'quoted'\nline"]);
$config = ClientConfigService::clash($template, $nodes);
$parsed = Yaml::parse(Yaml::dump($config, 8));
$assert($parsed === $config && !str_contains(Yaml::dump($config), '$app_name'));
$assert(end($config['proxy-groups'])['proxies'] === ['REJECT']);
$assert($config['allow-lan'] === false);
$assert($config['proxy-groups'][1]['interval'] === 600);
$empty = ClientConfigService::clash($template, []);
$assert(count($empty['proxy-groups']) === count($template['proxy-groups']));
$provider = ClientConfigService::clash(['proxy-groups' => [['name' => 'Provider', 'type' => 'select', 'use' => ['remote']]]], []);
$assert($provider['proxy-groups'][0]['proxies'] === []);

$user = ['uuid' => 'test', 'u' => 0, 'd' => 0, 'transfer_enable' => 1000, 'expired_at' => time()+86400];
$servers = [
    ['name'=>'Same', 'type'=>'shadowsocks', 'cipher'=>'aes-128-gcm', 'host'=>'node.example', 'port'=>443],
    ['name'=>'Same', 'type'=>'shadowsocks', 'cipher'=>'aes-128-gcm', 'host'=>'node2.example', 'port'=>443],
];
foreach (['ClashMeta', 'ClashVerge', 'ClashNyanpasu', 'Stash'] as $name) {
    $class = 'App\\Protocols\\'.$name;
    $data = Yaml::parse((new $class($user, $servers))->handle());
    $assert(count(array_unique(array_column($data['proxies'], 'name'))) === 2);
    $known = array_merge(['DIRECT','REJECT'], array_column($data['proxies'], 'name'), array_column($data['proxy-groups'], 'name'));
    foreach ($data['proxy-groups'] as $group) foreach ($group['proxies'] as $member) $assert(in_array($member, $known, true));
}
$sing = json_decode((new App\Protocols\Singbox($user, $servers))->handle()->getContent(), true);
$assert(count(array_unique(array_column($sing['outbounds'], 'tag'))) === count($sing['outbounds']));
$assert($sing['route']['default_http_client'] === 'rule-download');
$assert($sing['http_clients'][0]['detour'] === '节点选择');
foreach ($sing['route']['rule_set'] as $ruleSet) {
    $assert(!isset($ruleSet['download_detour']) && $ruleSet['http_client'] === 'rule-download');
}

$service = new ClientReleaseService;
$calls = 0;
Http::fake(function ($request) use (&$calls, $assert) {
    $calls++;
    $assert($request->url() === 'https://api.github.com/repos/clash-verge-rev/clash-verge-rev/releases/latest');
    return Http::response(['tag_name'=>'v1.0.0','prerelease'=>false,'published_at'=>'2026-10-01T00:00:00Z','body'=>'Release notes'], 200, ['ETag'=>'"first"']);
});
$state = $service->check('clash-verge');
$assert($state['version'] === 'v1.0.0' && !$state['error']);
$service->check('clash-verge');
$assert($calls === 1);
$expire = function () { $s=Cache::get('client-release:clash-verge'); $s['attempted_at']=time()-301; Cache::forever('client-release:clash-verge',$s); };
$expire();
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(function ($request) use ($assert) { $assert($request->hasHeader('If-None-Match', '"first"')); return Http::response('',304); });
$assert($service->check('clash-verge')['version'] === 'v1.0.0');
foreach ([429,500] as $code) {
    $expire(); Http::swap(new Illuminate\Http\Client\Factory); Http::fake(['*'=>Http::response([], $code)]);
    $state=$service->check('clash-verge');
    $assert($state['version']==='v1.0.0' && !empty($state['error']));
}
$expire(); Http::swap(new Illuminate\Http\Client\Factory); Http::fake(['*'=>Http::response(['tag_name'=>'v2-beta','prerelease'=>true])]);
$assert($service->check('clash-verge')['version']==='v1.0.0');
$expire(); Http::swap(new Illuminate\Http\Client\Factory); Http::fake(function () { throw new Illuminate\Http\Client\ConnectionException('timeout'); });
$assert(!empty($service->check('clash-verge')['error']));
$expire(); Http::swap(new Illuminate\Http\Client\Factory); Http::fake(['*'=>Http::response(['tag_name'=>'v2.0','prerelease'=>false])]);
$state=$service->check('clash-verge');
$assert($state['version']==='v2.0' && $state['previous_version']==='v1.0.0' && !$state['error']);
try { $service->check('../../private'); $assert(false); } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422); }
echo "PASS: {$checks} client config / release checks\n";
