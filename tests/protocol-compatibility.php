<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\SubscriptionClientRegistry as R;
use App\Services\ClientIdentity as C;
$n=0;
$assert = \Tests\Support\Assertions::counter($n);
$user=['uuid'=>'b831381d-6324-4d53-ad4f-8cda48b30811','u'=>0,'d'=>0,'transfer_enable'=>1024,'expired_at'=>null];
$base=['name'=>'Node','host'=>'node.example.test','port'=>'443','tls'=>1,'tls_settings'=>['server_name'=>'node.example.test','allow_insecure'=>0],'network'=>'tcp','network_settings'=>[],'obfs'=>null,'disable_sni'=>0,'zero_rtt_handshake'=>0,'flow'=>'xtls-rprx-vision','cipher'=>'aes-128-gcm','server_key'=>'test','udp_relay_mode'=>'native','congestion_control'=>'bbr','insecure'=>0,'server_name'=>'node.example.test','version'=>2,'up_mbps'=>100,'down_mbps'=>100];
$servers=[];
foreach(['shadowsocks','vmess','vless','trojan','tuic','anytls','hysteria'] as $type) $servers[]=array_merge($base,['type'=>$type,'name'=>$type]);
$verge=(new App\Protocols\ClashVerge($user,$servers))->handle();
$assert($verge===(new App\Protocols\ClashMeta($user,$servers))->handle(),'Verge shares Mihomo rendering');
$assert((new App\Protocols\V2rayN($user,$servers))->handle()===(new App\Protocols\V2rayNG($user,$servers))->handle(),'URI clients share identical output');
$assert(str_contains(base64_decode((new App\Protocols\UriSubscription($user,[$servers[2]]))->handle()),'vless://'),'Shared URI renderer emits usable links');
$assert(R::canonicalId('uri')===null && R::canonicalId('general')===null,'Shared renderer does not expose generic fallback');
foreach(R::CLIENTS as $flag=>[$id,$class]) {
 $assert(R::canonicalId($id)===$flag && R::canonicalId($flag)===$id,'Canonical/legacy roundtrip '.$flag);
 $assert(R::handler($flag)===R::handler($id),'Same renderer for canonical and old flag '.$flag);
}
foreach(['meta'=>'mihomo','sing'=>'sing-box','verge'=>'clash-verge','quantumult%20x'=>'quantumult-x','clash-meta'=>'mihomo'] as $old=>$canonical) $assert(R::canonicalId($old)===null,'Old identifier rejected '.$old);
foreach(['mihomo.party/v1.8.0'=>'clash-party','Throne/1.3.2'=>'throne','Throne/Android/1.2.0'=>'throne','NekoBox/Android/1.4.0 (Prefer ClashMeta Format)'=>'nekobox','husi/0.3.0 (sing-box 1.12.0)'=>'husi'] as $ua=>$client) {
 $assert(C::identify($ua)===$client,'Official UA '.$client);
 $assert(!R::defaultEnabled($client),'New client requires opt-in '.$client);
 $assert(C::version($client,$ua)!==null,'Application version '.$client);
}
$assert(R::compatible('throne','v2rayn') && !R::compatible('throne','surge'),'URI format compatibility is explicit');
$assert(!R::compatible('invalid','invalid'),'Unknown names never form a compatible pair');
$plain = array_merge($base, ['tls'=>0]);
$assert(isset(App\Protocols\ClashVerge::buildVless($user['uuid'],$plain)['flow']), 'Verge keeps flow outside TLS branch');
$assert(!isset(App\Protocols\ClashNyanpasu::buildVless($user['uuid'],$plain)['flow']), 'Nyanpasu keeps historical TLS-specific flow');
$encrypted = array_merge($base, ['encryption'=>'mlkem768x25519plus','encryption_settings'=>['mode'=>'native','rtt'=>'1rtt','password'=>'example']]);
foreach ([App\Protocols\ClashMeta::class, App\Protocols\ClashNyanpasu::class] as $renderer) {
 $assert(!isset($renderer::buildVless($user['uuid'],$encrypted)['encryption']), 'Retired VLESS encryption is not exported');
 $assert(!isset($renderer::buildVmess($user['uuid'],$encrypted)['encryption']), 'Retired VMess encryption extension is not exported');
}
$nyan = Symfony\Component\Yaml\Yaml::parse((new App\Protocols\ClashNyanpasu($user, [array_merge($plain,['type'=>'vless'])]))->handle());
$assert(!isset($nyan['proxies'][0]['flow']), 'Shared handle dispatches the Nyanpasu TLS-specific flow builder');
echo "Protocol compatibility: {$n} checks passed\n";