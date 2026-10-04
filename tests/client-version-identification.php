<?php
require __DIR__.'/../vendor/autoload.php';
$s=new App\Services\ClientStrategyService;
$cases=[['meta','meta','ClashMetaForAndroid/2.11.0',null],['sing','sing','SFI/1.0.0',null],['sing','sing1.14','Mozilla/5.0',null],['sing','sing','FlClash/0.8.99 sing-box/1.14.1','1.14.1'],['flclash','flclash','FlClash/0.8.99 mihomo/1.19.0','0.8.99'],['verge','verge','mihomo/1.19.0',null],['meta','meta','mihomo/1.19.0','1.19.0'],['sing','sing','Hiddify/2.0.0',null],['sing','sing','sing-box/1.14.0','1.14.0']];
foreach($cases as [$type,$flag,$ua,$expected])if($s->resolveClientVersion($type,$flag,$ua)!==$expected)throw new RuntimeException('Wrong version: '.$ua);
echo 'PASS: '.count($cases)." version identification checks\n";
