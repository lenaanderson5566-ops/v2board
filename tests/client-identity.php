<?php
require __DIR__.'/../vendor/autoload.php';
use App\Services\ClientIdentity as C;
$n=0;
$assert=function($ok,$label)use(&$n){if(!$ok)throw new RuntimeException($label);$n++;};
foreach(C::ALIASES as $type=>$aliases) foreach($aliases as $alias){
 $assert(C::identify($alias.'/2.3.4')===$type,'Identify '.$alias);
 $assert(C::version($type,$alias.'/2.3.4')==='2.3.4','Version '.$alias);
}
foreach(['','Mozilla/5.0 FlClash/0.8.0','FakeFlClash/1.2.0','curl/8.0'] as $ua){
 $assert(!C::whitelistAllows($ua,true,['flclash']),'Reject '.$ua);
 $assert(C::whitelistAllows($ua,false,[]),'Disabled whitelist');
}
$assert(C::whitelistAllows('FlClash/0.8.0',true,['flclash']),'Selected client');
$assert(!C::whitelistAllows('FlClash/0.8.0',true,['meta']),'App does not inherit kernel whitelist');
$assert(C::identify('ClashMetaForAndroid/2.11.0')==='meta','CMFA kernel category');
$assert(C::version('meta','ClashMetaForAndroid/2.11.0')===null,'No guessed CMFA kernel');
$assert(C::version('sing','Hiddify/2.0.0')===null,'No guessed Hiddify kernel');
$assert(C::version('verge','ClashVerge/2.0.0-rc.1')==='2.0.0-rc.1','Preserve prerelease');
$assert(!C::allowsVersion('2.0.0','2.0.0-rc.1'),'Prerelease below stable');
$assert(C::allowsVersion('v2.0.0','2.0'),'Equivalent segments');
$assert(!C::allowsVersion('2.0.0',null),'Unknown version blocked');
$assert(!C::allowsVersion('garbage 2.0','3.0'),'Invalid saved minimum fails closed');
$assert(C::allowsVersion('',null),'Empty minimum unrestricted');
foreach(['abc1.2','1.2oops','>=1.2','1.2.3.4.5'] as $v) $assert(C::normalizeVersion($v)===null,'Invalid '.$v);
echo "Client identity: {$n} checks passed\n";

foreach (['HiddifyNext/2.0.0 (linux) like ClashMeta v2ray sing-box', 'HiddifyNextX/2.0.0 (linux) like ClashMeta v2ray sing-box'] as $ua) {
 $assert(C::identify($ua)==='sing','Official Hiddify prefix');
 $assert(C::version('sing',$ua)===null,'Do not infer kernel from Hiddify app version');
}
$assert(C::identify('FlClash/v0.8.0 clash-verge Platform/linux')==='flclash','Official FlClash UA preserves app identity');
$assert(C::version('flclash','FlClash/v0.8.0 clash-verge Platform/linux')==='0.8.0','Official FlClash version');
$assert(C::identify('Linux x86_64')===null,'OS is not a client');
$assert(C::identify('curl/8.0 FlClash/0.8.0')===null,'Embedded alias is not a client');
foreach (App\Services\SubscriptionClientRegistry::CLIENTS as $flag=>[$id,$class]) {
 $assert(App\Services\SubscriptionClientRegistry::flag($id)===$flag,'Canonical mapping '.$id);
 $assert(class_exists($class),'PSR class filename '.$id);
}
$assert(App\Services\SubscriptionClientRegistry::flag('quantumult x')==='quantumult%20x','Legacy Quantumult alias');
$assert(App\Services\SubscriptionClientRegistry::flag('general')===null,'No general format');
$assert(App\Services\SubscriptionClientRegistry::flag('fake-meta')===null,'No substring format match');
echo "Extended client registry checks passed\n";
