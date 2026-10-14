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
$assert(!C::whitelistAllows('FlClash/0.8.0',true,['mihomo']),'App does not inherit kernel whitelist');
$assert(C::identify('ClashMetaForAndroid/2.11.0')==='mihomo','CMFA kernel category');
$assert(C::version('mihomo','ClashMetaForAndroid/2.11.0')===null,'No guessed CMFA kernel');
$assert(C::version('sing-box','Hiddify/2.0.0')===null,'No guessed Hiddify kernel');
$assert(C::version('clash-verge','ClashVerge/2.0.0-rc.1')==='2.0.0-rc.1','Preserve prerelease');
$assert(!C::allowsVersion('2.0.0','2.0.0-rc.1'),'Prerelease below stable');
$assert(C::allowsVersion('v2.0.0','2.0'),'Equivalent segments');
$assert(!C::allowsVersion('2.0.0',null),'Unknown version blocked');
$assert(!C::allowsVersion('garbage 2.0','3.0'),'Invalid saved minimum fails closed');
$assert(C::allowsVersion('',null),'Empty minimum unrestricted');
foreach(['abc1.2','1.2oops','>=1.2','1.2.3.4.5'] as $v) $assert(C::normalizeVersion($v)===null,'Invalid '.$v);
echo "Client identity: {$n} checks passed\n";

foreach (['HiddifyNext/2.0.0 (linux) like ClashMeta v2ray sing-box', 'HiddifyNextX/2.0.0 (linux) like ClashMeta v2ray sing-box'] as $ua) {
 $assert(C::identify($ua)==='sing-box','Official Hiddify prefix');
 $assert(C::version('sing-box',$ua)===null,'Do not infer kernel from Hiddify app version');
}
$assert(C::identify('FlClash/v0.8.0 clash-verge Platform/linux')==='flclash','Official FlClash UA preserves app identity');
$assert(C::version('flclash','FlClash/v0.8.0 clash-verge Platform/linux')==='0.8.0','Official FlClash version');
foreach (['SFW', 'SFL'] as $shell) {
 $ua = $shell.' (sing-box 1.14.3; language zh_CN)';
 $assert(C::identify($ua)==='sing-box','Desktop shell identity '.$shell);
 $assert(C::version('sing-box',$ua)==='1.14.3','Desktop shell uses explicit kernel version '.$shell);
 $assert(C::version('sing-box',$shell.'/2.0.0')===null,'Shell app version is not the kernel version '.$shell);
 $assert(C::identify('Mozilla/5.0 '.$ua)===null,'Embedded desktop shell rejected '.$shell);
 $assert(C::identify($shell.'Fake/1.0')===null,'Desktop shell requires product boundary '.$shell);
}
$assert(C::identify('Linux x86_64')===null,'OS is not a client');
$assert(C::identify('curl/8.0 FlClash/0.8.0')===null,'Embedded alias is not a client');
foreach (App\Services\SubscriptionClientRegistry::CLIENTS as $flag=>[$id,$class]) {
 $assert(App\Services\SubscriptionClientRegistry::canonicalId($id)===$flag,'Canonical mapping '.$id);
 $assert(class_exists($class),'PSR class filename '.$id);
}
$assert(App\Services\SubscriptionClientRegistry::canonicalId('quantumult x')===null,'Legacy Quantumult alias');
$assert(App\Services\SubscriptionClientRegistry::canonicalId('general')===null,'No general format');
$assert(App\Services\SubscriptionClientRegistry::canonicalId('fake-meta')===null,'No substring format match');
echo "Extended client registry checks passed\n";

foreach (array_keys(C::ALIASES) as $type) {
 foreach (C::matchingAliases($type) as $alias) {
  $assert(C::identify($alias.'/1.2.3') === $type, 'Displayed UA alias matches '.$alias);
  $assert(C::identify('Mozilla/5.0 '.$alias.'/1.2.3') === null, 'Embedded UA alias remains rejected '.$alias);
 }
}
echo "Displayed UA aliases match recognition rules\n";

$s=new App\Services\ClientStrategyService;
$cases=[['meta','meta','ClashMetaForAndroid/2.11.0',null],['sing','sing','SFI/1.0.0',null],['sing','sing1.14','Mozilla/5.0',null],['sing','sing','FlClash/0.8.99 sing-box/1.14.1','1.14.1'],['flclash','flclash','FlClash/0.8.99 mihomo/1.19.0','0.8.99'],['verge','verge','mihomo/1.19.0',null],['meta','meta','mihomo/1.19.0','1.19.0'],['sing','sing','Hiddify/2.0.0',null],['sing','sing','sing-box/1.14.0','1.14.0']];
$versionChecks = 0;
foreach ($cases as [$type, $flag, $ua, $expected]) {
    $canonical = ['meta'=>'mihomo', 'sing'=>'sing-box', 'verge'=>'clash-verge'][$type] ?? $type;
    if ($s->resolveClientVersion($canonical, $flag, $ua) !== $expected) throw new RuntimeException('Wrong version: '.$ua);
    $versionChecks++;
    if ($canonical !== $type) {
        if ($s->resolveClientVersion($type, $flag, $ua) !== null) throw new RuntimeException('Legacy category must not guess a version');
        $versionChecks++;
    }
}
echo 'PASS: '.$versionChecks." version identification checks\n";
