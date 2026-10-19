<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
$catalog = App\Services\NodeDisplayService::catalog();
$assert($catalog['regions'] === App\Services\NodeCountryDictionary::all(), 'Node regions use node-only country dictionary');
$assert(App\Services\NodeCountryDictionary::name(' us ', 'zh-CN') === '美国', 'Node codes normalize to localized names');
$assert(App\Services\NodeCountryDictionary::name('US', 'unsupported') === 'United States', 'Unknown language falls back to English');
$assert(App\Services\NodeCountryDictionary::name('ZZ') === null && App\Services\NodeCountryDictionary::name(null) === null, 'Unknown country is not inferred');
$geo = new App\Services\GeoIpService();
foreach ([null, '', 'not-an-ip', '127.0.0.1', '10.0.0.1', '::1'] as $ip) {
    $assert($geo->lookup($ip) === ['country'=>null,'region'=>null,'city'=>null,'asn'=>null,'isp'=>null], 'Invalid/private IP retains legacy log shape');
    $assert($geo->sessionCountry($ip) === null, 'Invalid/private IP has no inferred country');
}
$assert(App\Services\NodeDisplayService::name(['name'=>'Legacy', 'country'=>'Japan', 'region'=>'Tokyo'], 'en-US') === 'Legacy', 'GeoIP observations cannot supply node display metadata');
$assert(App\Services\NodeDisplayService::name(['name'=>'Legacy', 'region_code'=>'US', 'country'=>'Japan'], 'en-US') === 'United States', 'Configured node country is independent of GeoIP');

// Exercise real GeoIP enrichment using deterministic local reader records.
$readersProperty = new ReflectionProperty(App\Services\GeoIpService::class, 'readers');
$savedReaders = $readersProperty->getValue();
$reader = new class extends GeoIp2\Database\Reader {
    public string $code = 'US';
    public function __construct() {}
    public function country(string $ipAddress): GeoIp2\Model\Country {
        return new GeoIp2\Model\Country(['country'=>['iso_code'=>$this->code, 'names'=>['en'=>'Provider country', 'zh-CN'=>'数据库名称']]]);
    }
};
try {
    $readersProperty->setValue(null, ['country'=>$reader, 'city'=>null, 'asn'=>null]);
    $assert($geo->lookup('8.8.8.8')['country'] === '数据库名称', 'GeoIP preserves provider names independently of node dictionary');
    $assert($geo->sessionCountry('8.8.8.8') === 'US', 'Session retains observed ISO code');
    $reader->code = 'ZZ';
    $assert($geo->lookup('8.8.8.8')['country'] === '数据库名称', 'Unrecognized country preserves provider name');
} finally {
    $readersProperty->setValue(null, $savedReaders);
}
foreach (['regions', 'cities'] as $kind) {
    foreach ($catalog[$kind] as $code => $names) {
        foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
            $assert(!empty($names[$language]), 'Missing '.$language.' '.$kind.' '.$code);
        }
    }
}
foreach ($catalog['cityRegions'] as $city => $region) {
    $assert(isset($catalog['cities'][$city], $catalog['regions'][$region]), 'City reference has valid translations and country: '.$city);
}
$assert(count($catalog['cityRegions']) === count($catalog['cities']), 'All reference cities have country mappings');
$assert(count($catalog['locationKinds']) === count($catalog['cities']), 'Every location has a state or city classification');
$assert($catalog['locationKinds']['california'] === 'state' && $catalog['locationKinds']['tokyo'] === 'city', 'States and cities are classified');
$assert(!isset($catalog['cities']['northern-california'], $catalog['cities']['northern-virginia']), 'Directional cloud region labels are not offered');
$tw = ['id'=>124, 'type'=>'vless', 'name'=>'Legacy', 'region_code'=>'TW'];
foreach ($catalog['regions']['TW'] as $language => $name) {
    $public = App\Services\NodeDisplayService::publicServers([$tw], $language);
    $assert($public[0]['name'] === '🇨🇳 TW · '.str_replace(',', '，', $name), 'TW uses localized China designation and Chinese flag: '.$language);
}
$normalize = [App\Services\NodeDisplayService::class, 'normalizeInput'];
$assert($normalize(['city_code'=>'San Jose'])['city_code']==='san-jose', 'English city case and spaces normalized');
$assert($normalize(['city_code'=>'  SAN_JOSE  '])['city_code']==='san-jose', 'Whitespace and underscores normalized');
$assert($normalize(['city_code'=>'圣何塞'])['city_code']==='san-jose', 'Catalog Chinese city normalized');
$assert($normalize(['region_code'=>' us '])['region_code']==='US', 'Country code normalized');
$assert($normalize([])===[], 'Omitted fields stay omitted');
$assert($normalize(['city_code'=>['invalid']])===[], 'Invalid types retained for validator rejection');
foreach (['v2node','v2box'] as $protocol) {
    $response = app(App\Http\Controllers\V1\Admin\ConsoleController::class)->nodeSchema(Illuminate\Http\Request::create('/', 'GET', ['type'=>$protocol]));
    $schema = json_decode($response->getContent(), true)['data'];
    $assert(isset($schema['city_code'], $schema['region_code'], $schema['rate']), $protocol.' schema retained');
    $validator = Illuminate\Support\Facades\Validator::make($normalize(['city_code'=>'San Jose']), ['city_code'=>$schema['city_code']], App\Services\NodeDisplayService::validationMessages());
    $assert(!$validator->fails(), $protocol.' accepts normalized city');
}
$assert(!isset($catalog['cloudProviders']), 'Catalog contains geography only');
$assert($normalize(['region_code'=>'US', 'city_code'=>'California'])['city_code'] === 'california', 'State name normalizes');
$assert($normalize(['city_code'=>'us-west-1'])['city_code'] === 'us-west-1', 'Cloud codes have no geographic alias mapping');
$mismatch = false;
try { $normalize(['region_code'=>'US', 'city_code'=>'Tokyo']); }
catch (Illuminate\Validation\ValidationException $error) { $mismatch = isset($error->errors()['city_code']); }
$assert($mismatch, 'Known location cannot be saved under another country');

$assert(App\Services\NodeDisplayService::name(['name'=>'Legacy','region_code'=>'US','city_code'=>'oregon','display_label'=>'A'], 'zh-CN') === '美国 · 俄勒冈州 · A', 'Regional location renders in native and public names');
$server=['id'=>123,'type'=>'shadowsocks','name'=>'Japan-A','region_code'=>'JP','city_code'=>'tokyo','display_label'=>'A','tags'=>['premium'],'cipher'=>'aes-128-gcm','host'=>'node.example','port'=>443];
$enriched=App\Services\NodeDisplayService::enrich($server);
$assert($enriched['proxy_name']==='node_shadowsocks_123','Stable identity');
$assert($enriched['display_names']['zh-CN']==='日本 · 东京 · A','Chinese name');
$assert($enriched['display_names']['en-US']==='Japan · Tokyo · A','English name');
$assert(App\Services\NodeDisplayService::name(['name'=>'Legacy'], 'en-US')==='Legacy','Unconfigured nodes retain names');
foreach ([
    [[], '美国'],
    [['city_code'=>'california'], '美国 · 加利福尼亚州'],
    [['city_code'=>'san-jose'], '美国 · 圣何塞'],
    [['display_label'=>'A'], '美国 · A'],
    [['city_code'=>null, 'display_label'=>'  '], '美国'],
    [['city_code'=>'san-jose', 'display_label'=>'A'], '美国 · 圣何塞 · A'],
] as [$fields, $expected]) {
    $node = array_merge(['name'=>'Legacy-Operator-Name','region_code'=>'US'], $fields);
    $assert(App\Services\NodeDisplayService::name($node, 'zh-CN') === $expected, 'Optional city and suffix render independently');
    $assert(App\Services\NodeDisplayService::metadata($node)['displayNames']['zh-CN'] === $expected, 'Native metadata uses optional naming');
}
$countryOnly = [['name'=>'Original-A', 'region_code'=>'US'], ['name'=>'Original-B', 'region_code'=>'US']];
$readable = App\Services\NodeDisplayService::publicServers($countryOnly, 'en-US');
$assert($readable[0]['name'] === '🇺🇸 US · United States' && $readable[1]['name'] === '🇺🇸 US · United States (2)', 'Public country-only names stay unique without legacy suffixes');
$countryTemplate = ['proxy-groups'=>[['name'=>'Country','type'=>'select','proxies'=>['/Original-A/']]], 'rules'=>['MATCH,Country']];
$countryConfig = App\Services\ClientConfigService::clash($countryTemplate, array_map(fn($node)=>['name'=>$node['name'],'type'=>'ss'], $readable), $readable);
$assert($countryConfig['proxy-groups'][0]['proxies'] === [$readable[0]['name']], 'Country-only duplicates preserve individual original-name regex mappings');
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
