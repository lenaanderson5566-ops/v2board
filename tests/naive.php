<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\ServerV2box;
use App\Http\Controllers\V1\Admin\Server\V2boxController;
use App\Services\SubscriptionClientRegistry as Clients;

$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
try {
    $admin=new V2boxController();
    $base=['group_id'=>[999999],'name'=>'Naive 测试','host'=>'naive.example.test','port'=>'443','server_port'=>443,'listen_ip'=>'0.0.0.0','protocol'=>'naive','tls'=>1,'network'=>'tcp','disable_sni'=>0,'zero_rtt_handshake'=>0,'rate'=>'1','show'=>1,'tls_settings'=>['cert_mode'=>'http','server_name'=>'naive.example.test','allow_insecure'=>0]];
    $admin->save(Request::create('/','POST',$base));
    $node=ServerV2box::where('name',$base['name'])->firstOrFail();
    $assert($node->protocol==='naive' && (int)$node->tls===1,'Naive persisted in V2Box table');
    foreach ([['tls'=>0],['tls'=>2],['network'=>'ws'],['network'=>'grpc'],['network'=>'udp'],['disable_sni'=>1],['tls_settings'=>['cert_mode'=>'none']],['tls_settings'=>['cert_mode'=>'self']],['tls_settings'=>['cert_mode'=>'remote']],['tls_settings'=>['allow_insecure'=>1]],['tls_settings'=>['server_name'=>'']],['tls_settings'=>['cert_mode'=>'file']]] as $invalid) {
        try{$admin->save(Request::create('/','POST',array_replace_recursive($base,$invalid,['id'=>$node->id])));throw new RuntimeException('Invalid Naive settings accepted');}
        catch(Illuminate\Validation\ValidationException $e){$checks++;}
    }
    foreach (['v2box'] as $backend) {
        $schema=json_decode((new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>$backend]))->getContent(),true)['data'];
        $assert(str_contains($schema['protocol'],'naive')===($backend==='v2box'),'Naive offered only for V2Box');
    }
    config(['fastai.server_token'=>'local-naive-test']);
    $request=Request::create('/api/v2/server/config','GET',['token'=>'local-naive-test','node_type'=>'v2box','node_id'=>$node->id]);
    $config=json_decode((new App\Http\Controllers\V2\Server\ServerController($request))->config($request)->getContent(),true);
    $assert($config['protocol']==='naive' && $config['network']==='tcp' && $config['tls_settings']['cert_mode']==='http','Node config retains Naive TLS settings');
    $user=['uuid'=>'b831381d-6324-4d53-ad4f-8cda48b30811','u'=>0,'d'=>0,'transfer_enable'=>1024,'expired_at'=>null];
    $server=$node->toArray();$server['type']='v2box';
    $supportedClients=['sing-box','shadowrocket','v2rayn','throne','husi','nekobox','passwall','sagernet'];
    foreach(array_keys(Clients::CLIENTS) as $client) {
        $assert(Clients::supportsNaive($client,$server)===in_array($client,$supportedClients,true),'Only verified clients accept Naive: '.$client);
    }
    $assert(!Clients::supportsNaive('unknown',$server),'Unknown clients cannot inherit Naive support');
    foreach([
        ['Naive.Example.Test.','naive.example.test',true],
        ['naive.example.test','NAIVE.EXAMPLE.TEST.',true],
        ['naive.example.test','different.example.test',false],
        ['2001:db8::1','',true],
        ['[2001:db8::1]','',true],
        ['[2001:db8::1]','2001:DB8::1',true],
        ['[2001:0db8:0000::1]','2001:db8::1',true],
        ['[2001:db8::1]','naive.example.test',false],
    ] as [$address,$sni,$supported]) {
        $variant=$server;$variant['host']=$address;$variant['server_name']=$sni;$variant['tls_settings']['server_name']='';
        $assert(Clients::supportsNaive('sagernet',$variant)===$supported,'SagerNet preserves its connection address and accepts only a representable TLS identity');
    }
    $uri=App\Utils\Helper::buildUri($user['uuid'],$server);
    $assert(str_starts_with($uri,'naive+https://'.$user['uuid'].':'.$user['uuid'].'@'),'URI credentials match panel');
    $assert(str_contains($uri,'sni=naive.example.test') && str_contains($uri,rawurlencode($base['name'])),'URI SNI and name');
    $ipv6=$server;$ipv6['host']='2001:db8::1';
    $assert(str_contains(App\Utils\Helper::buildUri($user['uuid'],$ipv6),'@[2001:db8::1]:443'),'IPv6 URI brackets');
    $assert(base64_decode((new App\Protocols\V2rayN($user,[$server]))->handle())===$uri,'Identified URI client exports Naive');
    foreach(['v2rayn','throne','husi','nekobox','passwall','sagernet'] as $client) {
        $renderer=Clients::handler($client);
        $assert(base64_decode((new $renderer($user,[$server]))->handle(),true)===$uri,'Verified URI client keeps Naive credentials, endpoint and TLS name: '.$client);
    }
    $queryServer=$server;$queryServer['server_name']='A +~/';
    $queryUri=App\Utils\Helper::buildNaiveUri($user['uuid'],$queryServer);
    $assert(str_contains($queryUri,'?sni=A%20%2B~%2F#'),'Naive URI query data uses RFC3986 escaping without form-style spaces');
    $decodeShadowrocket=function($content)use($assert) {
        $decoded=base64_decode($content,true);
        $assert(is_string($decoded),'Shadowrocket subscription uses valid base64');
        $lines=array_values(array_filter(preg_split('/\r?\n/',$decoded),fn($line)=>str_starts_with($line,'http2://')));
        $assert(count($lines)===1,'Shadowrocket includes exactly one Naive HTTP2 proxy');
        $assert(preg_match('/^http2:\/\/([^?#]+)\?([^#]*)#(.*)$/D',$lines[0],$parts)===1,'Shadowrocket Naive URI has a complete encoded endpoint, query and name');
        $endpoint=base64_decode($parts[1],true);
        $assert(is_string($endpoint),'Shadowrocket encodes the whole Naive endpoint as base64');
        parse_str($parts[2],$query);
        $keys=array_keys($query);sort($keys);
        $assert($keys===['alpn','padding','peer'] && $query['alpn']==='h2' && $query['padding']==='1','Shadowrocket Naive requires HTTP2 ALPN and padding without insecure or Reality fields');
        $assert($parts[2]===http_build_query($query,'','&',PHP_QUERY_RFC3986),'Shadowrocket Naive query uses RFC3986 encoding');
        return [$endpoint,$query,$parts[3],$decoded,$lines[0]];
    };
    $before=serialize([$user,$server]);
    [$endpoint,$query,$fragment,,$shadowrocketUri]=$decodeShadowrocket((new App\Protocols\Shadowrocket($user,[$server]))->handle());
    $assert($endpoint===rawurlencode($user['uuid']).':'.rawurlencode($user['uuid']).'@naive.example.test:443','Shadowrocket endpoint retains the panel UUID as both username and password');
    $assert($query['peer']==='naive.example.test' && $fragment===rawurlencode($base['name']),'Shadowrocket retains Naive SNI and encoded Unicode node name');
    $assert(serialize([$user,$server])===$before,'Rendering Shadowrocket never mutates the user or node settings');
    if($fixture=getenv('NAIVE_SHADOWROCKET_FIXTURE')) {
        $fixtureNode=$node->fresh();
        $fixtureBody=json_encode(['uri'=>$shadowrocketUri,'uuid'=>$user['uuid'],'peer'=>$fixtureNode->tls_settings['server_name'],
            'host'=>$fixtureNode->host,'port'=>(int)$fixtureNode->port],JSON_THROW_ON_ERROR);
        $assert(file_put_contents($fixture,$fixtureBody)!==false && chmod($fixture,0600),'Synthetic Shadowrocket Naive fixture exported privately');
    }
    $alias=$server;$alias['type']='naive';unset($alias['protocol']);
    $assert((new App\Protocols\Shadowrocket($user,[$alias]))->handle()===(new App\Protocols\Shadowrocket($user,[$server]))->handle(),'Native Naive and V2Box protocol aliases produce the same Shadowrocket proxy');
    $upperUser=$user;$upperUser['uuid']=strtoupper($user['uuid']);
    foreach(['2001:db8::1','[2001:db8::1]'] as $address) {
        $variant=$server;$variant['host']=$address;$variant['name']='東京 / 节点 #1';
        $variant['server_name']='preferred.example.test';$variant['tls_settings']['server_name']='nested.example.test';
        [$endpoint,$query,$fragment]=$decodeShadowrocket((new App\Protocols\Shadowrocket($upperUser,[$variant]))->handle());
        $assert($endpoint===$upperUser['uuid'].':'.$upperUser['uuid'].'@[2001:db8::1]:443','Shadowrocket brackets IPv6 once and preserves UUID letter case');
        $assert($query['peer']==='preferred.example.test' && $fragment===rawurlencode($variant['name']),'Shadowrocket prefers the published SNI and safely encodes the name');
        $variant['server_name']='';
        [, $query]=$decodeShadowrocket((new App\Protocols\Shadowrocket($upperUser,[$variant]))->handle());
        $assert($query['peer']==='nested.example.test','Empty published SNI falls back to nested TLS identity');
        $variant['tls_settings']['server_name']='';
        [, $query]=$decodeShadowrocket((new App\Protocols\Shadowrocket($upperUser,[$variant]))->handle());
        $assert($query['peer']==='2001:db8::1','Missing Naive SNI falls back to the host without IPv6 brackets');
    }
    foreach([
        [' published.example.test ','nested.example.test','published.example.test'],
        ['', ' nested.example.test ','nested.example.test'],
        [null,'nested.example.test','nested.example.test'],
        [[], 'nested.example.test','nested.example.test'],
        ['  ','','2001:db8::1'],
    ] as [$published,$nested,$expected]) {
        $variant=$server;$variant['host']='[2001:db8::1]';$variant['server_name']=$published;$variant['tls_settings']['server_name']=$nested;
        $before=serialize([$upperUser,$variant]);
        $assert(App\Utils\Helper::naiveServerName($variant)===$expected,'Naive identity selects a usable published value, nested value, then the unbracketed host');
        $generic=trim(App\Utils\Helper::buildUri($upperUser['uuid'],$variant));
        parse_str(parse_url($generic,PHP_URL_QUERY),$genericQuery);
        $assert($genericQuery===['sni'=>$expected] && str_starts_with($generic,'naive+https://'.$upperUser['uuid'].':'.$upperUser['uuid'].'@[2001:db8::1]:443?'),'Generic Naive preserves endpoint and exact credentials while selecting TLS identity');
        [, $rocketQuery]=$decodeShadowrocket((new App\Protocols\Shadowrocket($upperUser,[$variant]))->handle());
        $singVariant=json_decode((new App\Protocols\Singbox($upperUser,[$variant]))->handle()->getContent(),true);
        $naiveOut=array_values(array_filter($singVariant['outbounds'],fn($row)=>($row['type']??null)==='naive'));
        $assert($rocketQuery['peer']===$expected && count($naiveOut)===1 && $naiveOut[0]['tls']['server_name']===$expected,'Generic, Shadowrocket and sing-box share Naive TLS identity semantics');
        $assert($naiveOut[0]['server']==='[2001:db8::1]' && $naiveOut[0]['username']===$upperUser['uuid'] && $naiveOut[0]['password']===$upperUser['uuid'],'Selecting a TLS name never replaces the sing-box connection endpoint or credentials');
        $assert(serialize([$upperUser,$variant])===$before,'Naive renderers leave published and nested settings unchanged');
    }
    $vless=$server;$vless['protocol']='vless';$vless['name']='Existing VLESS';
    $anytls=$server;$anytls['protocol']='anytls';$anytls['name']='Existing AnyTLS';
    [, , , $mixed]=$decodeShadowrocket((new App\Protocols\Shadowrocket($user,[$server,$vless,$anytls]))->handle());
    $assert(str_contains($mixed,trim(App\Utils\Helper::buildUri($user['uuid'],$vless)))
        && str_contains($mixed,trim(App\Utils\Helper::buildUri($user['uuid'],$anytls))),'Adding Naive preserves existing VLESS and AnyTLS proxies');
    $clash=Symfony\Component\Yaml\Yaml::parse((new App\Protocols\ClashMeta($user,[$server]))->handle());
    $assert(!array_filter($clash['proxies'] ?? [],fn($p)=>($p['type'] ?? '')==='naive'),'Unadapted Clash format omits Naive');
    $sing=json_decode((new App\Protocols\Singbox($user,[$server]))->handle()->getContent(),true);
    $out=array_values(array_filter($sing['outbounds'],fn($o)=>$o['type']==='naive'));
    $assert(count($out)===1 && $out[0]['username']===$user['uuid'] && $out[0]['password']===$user['uuid'],'sing-box Naive credentials');
    $assert($out[0]['server_port']===443 && $out[0]['tls']['enabled']===true && $out[0]['tls']['server_name']==='naive.example.test','sing-box endpoint and TLS');
    $assert(!isset($out[0]['tls']['utls'],$out[0]['tls']['insecure'],$out[0]['tls']['reality'],$out[0]['transport']),'No incompatible TLS or transport fields');
    foreach($sing['outbounds'] as $o) if(in_array($o['type'],['selector','urltest']) && in_array($o['tag'],['节点选择','自动选择'])) $assert(in_array($out[0]['tag'],$o['outbounds'],true),'Naive included in selector');
    if($fixture=getenv('NAIVE_CLIENT_FIXTURE')) {
        $fixtureNode=$node->fresh();
        $fixtureBody=json_encode(['uuid'=>$user['uuid'],'peer'=>$fixtureNode->tls_settings['server_name'],
            'host'=>$fixtureNode->host,'port'=>(int)$fixtureNode->port,
            'formats'=>['uri'=>trim($uri),'shadowrocket'=>$shadowrocketUri,'singbox'=>$out[0]]],JSON_THROW_ON_ERROR);
        $assert(file_put_contents($fixture,$fixtureBody)!==false && chmod($fixture,0600),'Synthetic Naive client formats exported privately with independent stored-model metadata');
    }
    $admin->save(Request::create('/','POST',array_replace_recursive($base,['id'=>$node->id,'tls_settings'=>['cert_mode'=>'file','cert_file'=>'/etc/certs/fullchain.pem','key_file'=>'/etc/certs/privkey.pem']])));
    $assert($node->fresh()->tls_settings['cert_mode']==='file','Existing certificate supported');
    echo "PASS: $checks Naive checks\n";
} finally {DB::rollBack();}
