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
