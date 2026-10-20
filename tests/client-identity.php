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

// Operational aliases cannot change authentication or subscription format rules.
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\ClientRecognition as R;
$rules=['flclash'=>['name'=>'FlClash Custom','aliases'=>['ExampleClient'],'priority'=>200]];
$valid=R::validate($rules);
$library=app(R::class);
$assert($library->identify('ExampleClient/1.2',$valid)['code']==='flclash','Custom product alias');
$assert($library->identify('Mozilla/5.0 ExampleClient/1.2',$valid)['code']==='other','No embedded alias match');
$assert($library->identify('ExampleClientFake/1.2',$valid)['code']==='other','Product boundary');
$assert(C::identify('ExampleClient/1.2')===null,'Display alias cannot change trusted registry');
$assert(!C::whitelistAllows('ExampleClient/1.2',true,['flclash']),'Display alias cannot bypass whitelist');
foreach (['FlClash','Mozilla','curl','Example.*','<script>'] as $alias) {
 try {R::validate(['flclash'=>['name'=>'Test','aliases'=>[$alias],'priority'=>100]]);throw new RuntimeException('Invalid alias accepted');}
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422,'Reject conflicting or unsafe alias');}
}
try {R::validate($rules+['mihomo'=>['name'=>'Mihomo','aliases'=>['ExampleClient-X'],'priority'=>10]]);throw new RuntimeException('Cross-client overlap accepted');}
catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422,'Reject prefix collision across clients');}
Illuminate\Support\Facades\DB::beginTransaction();
try {
 try {(new App\Services\ClientStrategyService())->updateStrategies([['client_type'=>'flclash','client_name'=>'Duplicate']]);throw new RuntimeException('Duplicate name writer accepted');}
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422,'Client names are maintained in dictionary');}
 $version=$library->snapshot()['version'];$library->save($rules,$version,1);
 $assert($library->identify('ExampleClient/2')['name']==='FlClash Custom','Saved name and alias');
 try {$library->save([],$version,1);throw new RuntimeException('Stale save accepted');}
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===409,'Global version conflict');}
 $library->save([],$version+1,1);
 $assert($library->identify('ExampleClient/2')['code']==='other','Restore removes custom aliases');
 $admin=App\Models\User::create(['email'=>'client-dictionary-test@example.test','password'=>password_hash('test-only',PASSWORD_DEFAULT),'is_admin'=>1,'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
 $auth=new App\Services\AuthService($admin);$token=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
 $kernel=app(Illuminate\Contracts\Http\Kernel::class);
 $prefix='/api/v1/'.config('v2board.secure_path',config('v2board.frontend_admin_path',hash('crc32b',config('app.key'))));
 $call=function($method,$path,$body=[],$authorized=true)use($kernel,$prefix,$token){$r=Illuminate\Http\Request::create($prefix.'/dictionary/clients'.$path,$method,[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json'],json_encode($body));if($authorized)$r->headers->set('Authorization',$token);return $kernel->handle($r);};
 $assert($call('GET','',[],false)->getStatusCode()===403,'Anonymous cannot read library');
 $assert($call('GET','')->getStatusCode()===200,'Admin reads library');
 $preview=$call('POST','/preview',['rules'=>$rules,'ua'=>'ExampleClient/2']);
 $assert($preview->getStatusCode()===200 && json_decode($preview->getContent(),true)['data']['code']==='flclash','Preview uses draft without persisting');
 $assert($call('POST','/save',['rules'=>$rules,'version'=>$version+2])->getStatusCode()===200,'Admin saves library');
 App\Models\SubscribeLog::create(['user_id'=>$admin->id,'email'=>$admin->email,'ip'=>'127.0.0.1','client_type'=>'mihomo','user_agent'=>'ExampleClient/2','status'=>'success']);
 $controller=new App\Http\Controllers\V1\Risk\LogController();
 $logs=$controller->getSubscribeLogs(Illuminate\Http\Request::create('/','GET',['keyword'=>'ExampleClient']))->getOriginalContent();
 $assert($logs['data'][0]->recognized_client['code']==='flclash','Log uses shared recognition');
 $assert($logs['data'][0]->client_type==='mihomo' && $logs['data'][0]->user_agent==='ExampleClient/2','Raw identity and UA retained');
 $report=new ReflectionMethod(App\Services\OperationsAnalytics::class,'applications');
 $categories=$report->invoke(new App\Services\OperationsAnalytics(),Illuminate\Support\Facades\DB::table('v2_subscribe_log')->where('user_id',$admin->id),"status = 'success'","status = 'failed'");
 $assert(count($categories)===1 && $categories[0]['code']==='flclash' && $categories[0]['success']===1,'Reports share recognition and exact counts');
 $admin->update(['is_admin'=>0]);
 $assert($call('POST','/save',['rules'=>[],'version'=>$version+3])->getStatusCode()===403,'Non-admin cannot save');
 $auth->removeAllSession();
} finally {Illuminate\Support\Facades\DB::rollBack();app()->forgetInstance(R::class);}
echo "Client recognition library: {$n} total identity checks passed\n";
