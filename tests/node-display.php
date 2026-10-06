<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert=function ($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$server=['id'=>123,'type'=>'shadowsocks','name'=>'Japan-A','region_code'=>'JP','city_code'=>'tokyo','display_label'=>'A','tags'=>['premium'],'cipher'=>'aes-128-gcm','host'=>'node.example','port'=>443];
$enriched=App\Services\NodeDisplayService::enrich($server);
$assert($enriched['proxy_name']==='node_shadowsocks_123','Stable identity');
$assert($enriched['display_names']['zh-CN']==='日本 · 东京 · A','Chinese name');
$assert($enriched['display_names']['en-US']==='Japan · Tokyo · A','English name');
$assert(App\Services\NodeDisplayService::name(['name'=>'Legacy'], 'en-US')==='Legacy','Unconfigured nodes retain names');
$public=App\Services\NodeDisplayService::publicServers([$server], 'en-US');
$assert(str_contains($public[0]['name'],'🇯🇵 JP · Japan · Tokyo · A'),'Public readable name');
$template=['proxy-groups'=>[['name'=>'Main','type'=>'select','proxies'=>['/Japan/']]],'rules'=>['MATCH,Main']];
$config=App\Services\ClientConfigService::clash($template,[['name'=>$public[0]['name'],'type'=>'ss']],$public);
$assert($config['proxy-groups'][0]['proxies']===[$public[0]['name']],'Original-name regex retained');
$template['rules'] = ['DOMAIN,example.com,Japan-A,no-resolve'];
$config=App\Services\ClientConfigService::clash($template,[['name'=>$public[0]['name'],'type'=>'ss']],$public);
$assert($config['rules'][0]==='DOMAIN,example.com,'.$public[0]['name'].',no-resolve','Direct node rule targets renamed');
$template['rules'] = ['MATCH,Main'];

$paths=[resource_path('rules/custom.fastai.yaml')];
$original=file_exists($paths[0]) ? file_get_contents($paths[0]) : null;
try {
 file_put_contents($paths[0], Symfony\Component\Yaml\Yaml::dump($template));
 $native=new App\Services\FastaiConfig(['uuid'=>'test','u'=>0,'d'=>0,'transfer_enable'=>1,'expired_at'=>time()+3600],[$server],true);
 $yaml=Symfony\Component\Yaml\Yaml::parse($native->handle());
 $assert($yaml['proxies'][0]['name']==='node_shadowsocks_123','Native YAML uses stable name');
 $assert($yaml['proxy-groups'][0]['proxies']===['node_shadowsocks_123'],'Native regex matches original name');
 $assert($native->nodes()[0]['proxyName']===$yaml['proxies'][0]['name'],'Metadata matches YAML');
 $other=$server;$other['id']=124;
 $native=new App\Services\FastaiConfig(['uuid'=>'test'],[$server,$other],true);
 $yaml=Symfony\Component\Yaml\Yaml::parse($native->handle());
 $assert(count(array_unique(array_column($yaml['proxies'],'name')))===2,'Duplicate display names keep distinct identities');
 $assert(count($native->nodes())===2,'Duplicate metadata preserved');
 $rules = app(App\Http\Controllers\V1\Admin\ConsoleController::class)->nodeSchema(Illuminate\Http\Request::create('/', 'GET', ['type'=>'v2node']));
 $schema = json_decode($rules->getContent(), true)['data'];
 $assert(isset($schema['region_code'], $schema['city_code'], $schema['display_label'], $schema['rate']), 'Admin dynamic schema retains all node fields');
 $validation = Illuminate\Support\Facades\Validator::make(['region_code'=>'ZZ'], ['region_code'=>'nullable|in:'.implode(',',App\Services\NodeDisplayService::regionCodes())]);
 $assert($validation->fails(), 'Unknown country rejected');
 $template['proxy-groups'][0]['proxies'] = ['/.*/'];
 file_put_contents($paths[0], Symfony\Component\Yaml\Yaml::dump($template));
 $fake=$server; $fake['id']=125; $fake['name']='剩余流量: 10GB';
 $native=new App\Services\FastaiConfig(['uuid'=>'test'],[$server,$fake],true);
 $parsed=Symfony\Component\Yaml\Yaml::parse($native->handle());
 $assert(count($native->nodes())===1 && count($parsed['proxies'])===1, 'Stable names cannot disguise subscription metadata');
 $template['proxy-groups'][]=['name'=>'node_shadowsocks_123','type'=>'select','proxies'=>['DIRECT']];
 file_put_contents($paths[0], Symfony\Component\Yaml\Yaml::dump($template));
 $rejected=false;
 try { (new App\Services\FastaiConfig(['uuid'=>'test'],[$server],true))->handle(); } catch (RuntimeException $error) { $rejected=true; }
 $assert($rejected,'Conflicting template identities rejected');


} finally { if ($original===null) unlink($paths[0]); else file_put_contents($paths[0],$original); }
echo "node display: {$checks} checks passed\n";
