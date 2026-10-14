<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Models\ServerV2box;
use App\Http\Controllers\V1\Admin\Server\V2boxController;

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
    try{(new App\Http\Controllers\V1\Admin\Server\V2nodeController())->save(Request::create('/','POST',$base));throw new RuntimeException('V2Node accepted Naive');}
    catch(Illuminate\Validation\ValidationException $e){$checks++;}
    foreach (['v2node','v2box'] as $backend) {
        $schema=json_decode((new App\Http\Controllers\V1\Admin\ConsoleController())->nodeSchema(Request::create('/','GET',['type'=>$backend]))->getContent(),true)['data'];
        $assert(str_contains($schema['protocol'],'naive')===($backend==='v2box'),'Naive offered only for V2Box');
    }
    config(['v2board.server_token'=>'local-naive-test']);
    $request=Request::create('/api/v2/server/config','GET',['token'=>'local-naive-test','node_type'=>'v2box','node_id'=>$node->id]);
    $config=json_decode((new App\Http\Controllers\V2\Server\ServerController($request))->config($request)->getContent(),true);
    $assert($config['protocol']==='naive' && $config['network']==='tcp' && $config['tls_settings']['cert_mode']==='http','Node config retains Naive TLS settings');
    $user=['uuid'=>'b831381d-6324-4d53-ad4f-8cda48b30811','u'=>0,'d'=>0,'transfer_enable'=>1024,'expired_at'=>null];
    $server=$node->toArray();$server['type']='v2box';
    $uri=App\Utils\Helper::buildUri($user['uuid'],$server);
    $assert(str_starts_with($uri,'naive+https://'.$user['uuid'].':'.$user['uuid'].'@'),'URI credentials match panel');
    $assert(str_contains($uri,'sni=naive.example.test') && str_contains($uri,rawurlencode($base['name'])),'URI SNI and name');
    $ipv6=$server;$ipv6['host']='2001:db8::1';
    $assert(str_contains(App\Utils\Helper::buildUri($user['uuid'],$ipv6),'@[2001:db8::1]:443'),'IPv6 URI brackets');
    $assert(base64_decode((new App\Protocols\V2rayN($user,[$server]))->handle())===$uri,'Identified URI client exports Naive');
    $assert(!str_contains(base64_decode((new App\Protocols\Shadowrocket($user,[$server]))->handle()),'naive+https://'),'Unadapted Shadowrocket format omits Naive');
    $clash=Symfony\Component\Yaml\Yaml::parse((new App\Protocols\ClashMeta($user,[$server]))->handle());
    $assert(!array_filter($clash['proxies'] ?? [],fn($p)=>($p['type'] ?? '')==='naive'),'Unadapted Clash format omits Naive');
    $sing=json_decode((new App\Protocols\Singbox($user,[$server]))->handle()->getContent(),true);
    $out=array_values(array_filter($sing['outbounds'],fn($o)=>$o['type']==='naive'));
    $assert(count($out)===1 && $out[0]['username']===$user['uuid'] && $out[0]['password']===$user['uuid'],'sing-box Naive credentials');
    $assert($out[0]['server_port']===443 && $out[0]['tls']['enabled']===true && $out[0]['tls']['server_name']==='naive.example.test','sing-box endpoint and TLS');
    $assert(!isset($out[0]['tls']['utls'],$out[0]['tls']['insecure'],$out[0]['tls']['reality'],$out[0]['transport']),'No incompatible TLS or transport fields');
    foreach($sing['outbounds'] as $o) if(in_array($o['type'],['selector','urltest']) && in_array($o['tag'],['节点选择','自动选择'])) $assert(in_array($out[0]['tag'],$o['outbounds'],true),'Naive included in selector');
    $admin->save(Request::create('/','POST',array_replace_recursive($base,['id'=>$node->id,'tls_settings'=>['cert_mode'=>'file','cert_file'=>'/etc/certs/fullchain.pem','key_file'=>'/etc/certs/privkey.pem']])));
    $assert($node->fresh()->tls_settings['cert_mode']==='file','Existing certificate supported');
    echo "PASS: $checks Naive checks\n";
} finally {DB::rollBack();}
