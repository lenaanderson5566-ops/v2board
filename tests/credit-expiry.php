<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use App\Models\User;
use App\Services\CreditExpiryService as Credits;
use Illuminate\Support\Facades\DB;
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
$templates=[];$auth=null;
$originalConfig=config('v2board');
DB::beginTransaction();
try {
 $u=User::create(['email'=>uniqid().'@example.com','password'=>'test','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'u'=>0,'d'=>0,'transfer_enable'=>0,'credit_balance'=>0]);
 Credits::grant($u,1000,'test-purchase-'.$u->id);$u->save();
 Credits::grant($u,100,'test-gift-'.$u->id,1);$u->save();
 $b=DB::table('v2_credit_batch')->where('user_id',$u->id)->orderBy('expires_at')->get();
 $assert($b[0]->remaining_bytes==100,'Gift should expire first');
 $assert(abs($b[0]->expires_at-Carbon\Carbon::now('UTC')->addMonthsNoOverflow(1)->timestamp)<5,'Gift expiry incorrect');
 $assert(abs($b[1]->expires_at-Carbon\Carbon::now('UTC')->addMonthsNoOverflow(12)->timestamp)<5,'Purchase expiry incorrect');
 Credits::consume($u,120);$u->save();
 $assert(DB::table('v2_credit_batch')->where('id',$b[0]->id)->value('remaining_bytes')==0,'Gift not consumed first');
 $assert($u->fresh()->credit_balance===980,'Mixed debit incorrect');
 Credits::grant($u,50,'test-expire-'.$u->id,1);$u->save();
 DB::table('v2_credit_batch')->where('reference','test-expire-'.$u->id)->update(['expires_at'=>time()-1]);
 $assert($u->fresh()->credit_balance===980,'Read includes expired credits');
 $assert(User::whereKey($u->id)->whereRaw(Credits::usableSql().' = 980')->exists(),'SQL and balance disagree');
 Credits::expire($u);$u->save();Credits::expire($u);$u->save();
 $assert(DB::table('v2_traffic_credit_log')->where('user_id',$u->id)->where('kind','expiry')->count()===1,'Expiry repeated');
 $assert($u->fresh()->credit_balance===980,'Expiry double deducted');
 DB::table('v2_credit_batch')->where('user_id',$u->id)->update(['expires_at'=>time()-1]);
 $assert($u->fresh()->credit_balance===0,'Expired access balance nonzero');
 $request=Illuminate\Http\Request::create('/api/v10/me'); $request->user=['id'=>$u->id];
 $response=(new App\Services\Actions\User\UserActions())->info($request);
 $account=json_decode($response->getContent(),true)['data'];
 $assert($account['credit_balance']===0,'Account API includes expired credits');
 $assert(!User::whereKey($u->id)->withUsableTraffic()->exists(),'Expired user still available to nodes');
 $assert(!(new App\Services\UserService())->isAvailable($u->fresh()),'Expired user still available');
 // No expiry cleanup has run for these batches: reads and authorization must still reject them.
 $assert((int)$u->fresh()->getRawOriginal('credit_balance')>0,'Fixture retains uncleaned expired balance');
 // A still-active period is independent of expired add-on credits.
 $u->transfer_enable=1000;$u->expired_at=time()+3600;$u->save();
 $assert((new App\Services\UserService())->isAvailable($u->fresh()) && User::whereKey($u->id)->withUsableTraffic()->exists(),'Active base plan remains usable after add-on expiry');
 $u->transfer_enable=0;$u->expired_at=0;$u->save();
 Credits::consume($u,20);$u->save();
 $assert($u->fresh()->credit_balance===0,'Overdraw below zero');

 // A notice must replace the whole configuration, including static template
 // proxies/providers. Fixtures are restored in this disposable copy.
 $staticProxy=['name'=>'Static expiry fixture','type'=>'ss','server'=>'static.expiry.example.test','port'=>443,'cipher'=>'aes-128-gcm','password'=>'fixture-template-credential'];
 foreach (['clash','fastai','app.clash'] as $name) {
  $file=resource_path('rules/custom.'.$name.'.yaml');
  $templates[$file]=is_file($file)?file_get_contents($file):null;
  $default=$name==='app.clash'?'app.clash':'default.'.$name;
  $template=Symfony\Component\Yaml\Yaml::parseFile(resource_path('rules/'.$default.'.yaml'));
  $template['proxies']=[$staticProxy];
  $template['proxy-providers']['expiry-secret-provider']=['type'=>'http','url'=>'https://private.expiry.example.test/provider?secret=fixture-provider-credential','path'=>'./fixture-provider.yaml','interval'=>3600];
  file_put_contents($file,Symfony\Component\Yaml\Yaml::dump($template,8,2));
 }
 $file=resource_path('rules/custom.sing-box.json');
 $templates[$file]=is_file($file)?file_get_contents($file):null;
 $template=json_decode(file_get_contents(resource_path('rules/default.sing-box.json')),true,512,JSON_THROW_ON_ERROR);
 $template['outbounds'][]=['type'=>'socks','tag'=>'Static expiry fixture','server'=>'static.expiry.example.test','server_port'=>443,'username'=>'fixture-template-credential'];
 file_put_contents($file,json_encode($template));
 config(['v2board.show_subscribe_method'=>0,'v2board.fastai_enabled'=>1,'v2board.fastai_releases'=>[],
  'v2board.subscription_user_minute_limit'=>1000,'v2board.subscription_user_day_limit'=>1000,'v2board.subscription_ip_minute_limit'=>1000,
  'v2board.credit_base_group_id'=>98766,'v2board.show_info_to_server_enable'=>0]);
 (new App\Services\ClientStrategyService())->updateStrategies([
  ['client_type'=>'flclash','is_enabled'=>true,'min_version'=>null],['client_type'=>'mihomo','is_enabled'=>true,'min_version'=>null],
  ['client_type'=>'sing-box','is_enabled'=>true,'min_version'=>null],['client_type'=>'fastai','is_enabled'=>true,'min_version'=>null],
 ]);
 $u->fill(['plan_id'=>1,'group_id'=>98765,'transfer_enable'=>1000,'expired_at'=>time()+3600]);$u->save();
 $node=['name'=>'Periodic expiry node','host'=>'periodic.expiry.example.test','port'=>'443','server_port'=>443,'protocol'=>'shadowsocks','cipher'=>'aes-128-gcm','group_id'=>[98765],'show'=>1,'sort'=>1,'rate'=>1,'tls'=>0,'network'=>'tcp','up_mbps'=>0,'down_mbps'=>0];
 App\Models\ServerV2box::create($node);
 App\Models\ServerV2box::create(array_replace($node,['name'=>'Credit fallback node','host'=>'credit.expiry.example.test','group_id'=>[98766],'sort'=>2]));
 $auth=new App\Services\AuthService($u);
 $session=$auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
 $customPath='/expiry-fixture-'.bin2hex(random_bytes(5));
 app('router')->get($customPath,[App\Http\Controllers\CustomSubscriptionController::class,'subscribe'])->middleware('client');
 $call=function($path,$accept='application/yaml',$method='GET',$etag=null)use($app,$session,$u){
  $request=Illuminate\Http\Request::create($path,$method,[],[],[],['HTTP_ACCEPT'=>$accept,'HTTP_USER_AGENT'=>str_contains($path,'format=sing-box')?'SFW (sing-box 1.14.3)':'FlClash/0.8.99','REMOTE_ADDR'=>'192.0.2.'.($u->id%240+10)]);
  $request->headers->set('Authorization','Bearer '.$session);
  if($etag!==null)$request->headers->set('If-None-Match',$etag);
  $app->instance('request',$request);
  return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
 };
 $public='/api/v10/subscriptions/'.$u->token;
 $notice=function($response,string $reason,?string $label=null)use($assert,$u) {
  $body=$response->getContent();$expanded=$body;
  $decoded=base64_decode(trim($body),true);if($decoded!==false)$expanded.="\n".$decoded;
  foreach(explode("\n",$expanded) as $line) {
   if(preg_match('~^(?:vmess|ssr)://([^#\s]+)~',trim($line),$match)) {
    $decoded=base64_decode(strtr($match[1],'-_','+/'),true);if($decoded!==false)$expanded.="\n".$decoded;
   }
  }
  $expanded.="\n".rawurldecode($expanded);
  $assert($response->getStatusCode()===200 && $response->headers->get('X-Subscription-Notice')===$reason,'Public unavailable configuration returns the precise machine-readable notice: '.$reason);
  $assert(str_contains($expanded,'203.0.113.10'),'Notice configuration uses only its reserved documentation host');
  if($label!==null)$assert(str_contains($expanded,$label),'The warning is visible as a node name');
  foreach(['fixture-template-credential','fixture-provider-credential','private.expiry.example.test','static.expiry.example.test','periodic.expiry.example.test','credit.expiry.example.test',$u->uuid,$u->token] as $secret) {
   $assert(!str_contains($expanded,$secret),'Notice excludes real account/template configuration: '.$secret);
  }
  $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'Notice configuration cannot be cached');
  $assert(!$response->headers->has('subscription-userinfo') && !$response->headers->has('profile-web-page-url'),'Notice response exposes no account export metadata');
 };
 $native='/api/v10/me/client-config?clientVersion=0.8.99&platform=windows';
 $routes=[$public.'?format=flclash',$public.'?format=sing-box',$public.'/application-config',
  $customPath.'?token='.$u->token.'&format=flclash',$native,$native.'&core=sing-box'];
 $active=$call($public.'?format=flclash');
 $assert($active->getStatusCode()===200 && str_contains($active->getContent(),'fixture-template-credential'),'Fixture demonstrates active subscription includes static custom-template credentials');
 $nodes=$call('/api/v10/me/nodes','application/json');$oldTag=$nodes->headers->get('ETag');
 $assert($nodes->getStatusCode()===200 && count(json_decode($nodes->getContent(),true)['data'])>0,'Active node-list fixture');
 $snapshot=$u->fresh();$oldGroup=App\Services\TrafficCreditService::effectiveGroupId($snapshot);
 DB::table('v2_user')->where('id',$u->id)->update(['expired_at'=>time()]);
 $assert(!(new App\Services\UserService())->isAccessSnapshotCurrent($snapshot,$oldGroup),'A stale access snapshot cannot outlive exact periodic expiry');
 foreach($routes as $path){
  $logsBefore=App\Models\SubscribeLog::where('user_id',$u->id)->max('id')??0;
  $response=$call($path,str_contains($path,'core=sing-box')?'application/json':'application/yaml','GET',$oldTag);
  if(str_starts_with($path,'/api/v10/me/client-config')) {
   $problem=json_decode($response->getContent(),true);
   $assert($response->getStatusCode()===403 && ($problem['code']??null)==='SUBSCRIPTION_UNAVAILABLE' && !$response->headers->has('X-Subscription-Notice'),'Native client preserves its structured unavailable response');
   $assert(!str_contains($response->getContent(),'fixture-template-credential') && !str_contains($response->getContent(),'periodic.expiry.example.test'),'Native error excludes both template and generated credentials');
  } else {
   $notice($response,'expired');
   $logs=App\Models\SubscribeLog::where('user_id',$u->id)->where('id','>',$logsBefore)->get();
   $assert($logs->count()===1 && $logs[0]->status==='failed' && $logs[0]->reason==='expired','A public/application notice records exactly one failed request with its reason');
  }
  $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'Unavailable ingress cannot cache a credential-bearing configuration');
 }
 $staleRequest=Illuminate\Http\Request::create('/api/v10/subscriptions/test','GET',['format'=>'flclash'],[],[],['HTTP_USER_AGENT'=>'FlClash/0.8.99']);$staleRequest->user=$snapshot;
 $action=new App\Services\Actions\Client\ClientActions();
 $notice($action->subscribe($staleRequest),'expired');
 $nodes=$call('/api/v10/me/nodes','application/json','GET',$oldTag);
 $assert($nodes->getStatusCode()===200 && json_decode($nodes->getContent(),true)['data']===[] && $nodes->headers->get('ETag')!==$oldTag,'Expired node list invalidates the previous nonempty ETag');
 $preview=$call('/api/v10/me/node-previews','application/json');
 $previewData=json_decode($preview->getContent(),true)['data']??[];
 $assert($preview->getStatusCode()===200 && count($previewData)>=2,'Expired account retains public route preview');
 foreach($previewData as $row)$assert(array_diff(array_keys($row),['nodeId','proxyName','name','regionCode','cityCode','displayLabel','tags','displayNames'])===[],'Preview includes display metadata only');
 $u=$u->fresh();Credits::grant($u,500,'expiry-route-valid-'.$u->id);$u->save();
 $creditConfig=$call($native,'application/json');$bundle=json_decode($creditConfig->getContent(),true)['data']??[];
 $assert($creditConfig->getStatusCode()===200 && str_contains($bundle['yaml']??'','credit.expiry.example.test') && !str_contains($bundle['yaml']??'','periodic.expiry.example.test'),'Valid independent credits keep only their effective group after period expiry');
 $publicCredit=$call($public.'?format=flclash');
 $assert($publicCredit->getStatusCode()===200 && !$publicCredit->headers->has('X-Subscription-Notice') && str_contains($publicCredit->getContent(),'credit.expiry.example.test'),'Valid independent credits retain a real public subscription instead of an expiry warning');
 $creditSnapshot=$u->fresh();$creditGroup=App\Services\TrafficCreditService::effectiveGroupId($creditSnapshot);
 DB::table('v2_credit_batch')->where('reference','expiry-route-valid-'.$u->id)->update(['expires_at'=>time()]);
 $assert(!(new App\Services\UserService())->isAccessSnapshotCurrent($creditSnapshot,$creditGroup),'Exact credit expiry invalidates a previously available configuration snapshot without cleanup');
 $assert($call($native,'application/json')->getStatusCode()===403,'Expiring credit cannot keep a native configuration authorized');
 $assert((int)$u->fresh()->getRawOriginal('credit_balance')>0,'Authorization does not depend on the expiry cleanup job');
 Credits::expire($u);$u->save();Credits::grant($u,25,'expiry-route-exhaust-'.$u->id);$u->save();
 Credits::consume($u,25);$u->save();
 $assert($u->fresh()->credit_balance===0,'Fully consumed independent credit is unavailable');
 $notice($call($public.'?format=flclash'),'expired');

 // Every public serializer can represent the same isolated warning node without
 // invoking the ordinary template/provider or real-user credential renderers.
 foreach(array_keys(App\Services\SubscriptionClientRegistry::CLIENTS) as $format) {
  if($format==='fastai')continue;
  $response=App\Services\SubscriptionNotice::response($format,'Subscription expired; renew your plan','expired');
  $notice($response,'expired','Subscription expired');
  $body=$response->getContent();
  if(in_array($format,['mihomo','clash-verge','flclash','clash-nyanpasu','clash-for-android','clash-for-windows','clashx','clash-party','nekobox','stash'],true)) {
   $parsed=Symfony\Component\Yaml\Yaml::parse($body);
   $assert(count($parsed['proxies']??[])===1 && empty($parsed['proxy-providers']) && empty($parsed['rule-providers']),'Warning YAML has one dummy node and no external providers: '.$format);
  } elseif($format==='sing-box') {
   $parsed=json_decode($body,true,512,JSON_THROW_ON_ERROR);
   $servers=array_values(array_filter($parsed['outbounds'],fn($row)=>isset($row['server'])));
   $assert(count($servers)===1 && $servers[0]['server']==='203.0.113.10','Warning sing-box has one reserved dummy server');
   $assert(!in_array('direct',array_column($parsed['outbounds'],'type'),true) && ($parsed['route']['final']??null)==='NOTICE'
    && empty($parsed['route']['rule_set']) && empty($parsed['dns']) && empty($parsed['inbounds']) && !str_contains($body,'://'),'Warning sing-box has no direct fallback, inbound, remote ruleset or DNS provider URL');
  } elseif($format==='shadowsocks') {
   $parsed=json_decode($body,true,512,JSON_THROW_ON_ERROR);
   $assert(count($parsed['servers']??[])===1 && $parsed['servers'][0]['server']==='203.0.113.10','Warning SIP008 has one reserved dummy server');
  }
 }
 foreach([['fastai','expired'],['unknown','expired'],['flclash','unknown_reason']] as [$format,$reason]) {
  try {App\Services\SubscriptionNotice::response($format,'Warning',$reason);throw new RuntimeException('Unsupported warning protocol/reason was accepted');}
  catch(Symfony\Component\HttpKernel\Exception\HttpException $error){$assert($error->getStatusCode()===422,'Public notice renderer rejects native/unknown format and unknown reason');}
 }
 $injection=App\Services\SubscriptionNotice::response('surge',"Warning\r\n[Proxy]\r\nInjected=http://private.expiry.example.test/provider?secret=fixture-provider-credential",'expired')->getContent();
 $assert(substr_count($injection,'[Proxy]')===1 && !str_contains($injection,'private.expiry.example.test') && !str_contains($injection,'fixture-provider-credential'),'Notice names cannot inject config sections or provider URLs');
 $localized=require resource_path('client/copy.php');
 $reasons=['no_plan','expired','traffic_exhausted','credits_expired','credits_exhausted','no_available_nodes','banned','client_disabled','client_version_too_low','subscription_changed','user_unavailable'];
 foreach(App\Services\LanguagePreferenceService::SUPPORTED as $language) {
  $assert(isset($localized[$language]) && array_diff($reasons,array_keys($localized[$language]))===[],'Every supported import language defines every subscription notice: '.$language);
  foreach($reasons as $reason)$assert(is_string($localized[$language][$reason]) && trim($localized[$language][$reason])!=='' && $localized[$language][$reason]!==$reason,'Subscription warning has readable localized copy: '.$language.'/'.$reason);
 }
 // Classification follows effective entitlement, without waiting for credit
 // expiry cleanup or implying that an account without any purchase has expired.
 // Fulfilled standalone credit packs retain a plan/group profile, with no base
 // allowance and expired_at=0. That profile is not an expired periodic plan.
 DB::table('v2_user')->where('id',$u->id)->update(['plan_id'=>1,'group_id'=>98765,'transfer_enable'=>0,'expired_at'=>0]);
 DB::table('v2_credit_batch')->where('user_id',$u->id)->update(['remaining_bytes'=>0,'expires_at'=>time()+3600]);
 $notice($call($public.'?format=flclash'),'credits_exhausted');
 DB::table('v2_credit_batch')->where('user_id',$u->id)->update(['expires_at'=>time()]);
 DB::table('v2_credit_batch')->where('reference','expiry-route-exhaust-'.$u->id)->update(['remaining_bytes'=>25]);
 DB::table('v2_user')->where('id',$u->id)->update(['credit_balance'=>25]);
 $notice($call($public.'?format=flclash'),'credits_expired');
 $assert((int)$u->fresh()->getRawOriginal('credit_balance')===25 && $u->fresh()->credit_balance===0,'Credit-expired warning does not depend on a cleanup job changing the raw balance');
 $new=User::create(['email'=>uniqid().'@example.com','password'=>'unused','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'transfer_enable'=>0]);
 $notice($call('/api/v10/subscriptions/'.$new->token.'?format=flclash'),'no_plan');
 DB::table('v2_user')->where('id',$new->id)->update(['account_deleted_at'=>time()]);
 $deleted=$call('/api/v10/subscriptions/'.$new->token.'?format=flclash');
 $assert($deleted->getStatusCode()===403 && !$deleted->headers->has('X-Subscription-Notice'),'Deleted-account credentials remain a hard denial');
 $generic=User::create(['email'=>uniqid().'@example.com','password'=>'unused','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'plan_id'=>1,'group_id'=>98765,'transfer_enable'=>0,'expired_at'=>null]);
 $notice($call('/api/v10/subscriptions/'.$generic->token.'?format=flclash'),'user_unavailable');
 DB::table('v2_user')->where('id',$u->id)->update(['plan_id'=>1,'transfer_enable'=>1000,'u'=>1000,'d'=>0,'expired_at'=>time()+3600]);
 $notice($call($public.'?format=flclash'),'traffic_exhausted');
 DB::table('v2_user')->where('id',$u->id)->update(['u'=>0,'group_id'=>98764]);
 // URI output has no custom-template/provider fallback; an empty permitted node
 // group can therefore be identified accurately as having no available nodes.
 (new App\Services\ClientStrategyService())->updateStrategies([['client_type'=>'v2rayn','is_enabled'=>true,'min_version'=>null]]);
 $emptyRequest=Illuminate\Http\Request::create($public.'?format=v2rayn','GET',[],[],[],['HTTP_USER_AGENT'=>'v2rayN/7.0.0','REMOTE_ADDR'=>'192.0.2.212']);
 $app->instance('request',$emptyRequest);
 $notice($app->make(Illuminate\Contracts\Http\Kernel::class)->handle($emptyRequest),'no_available_nodes');
 DB::table('v2_user')->where('id',$u->id)->update(['banned'=>1]);
 $notice($call($public.'?format=flclash'),'banned');
 DB::table('v2_user')->where('id',$u->id)->update(['banned'=>0,'group_id'=>98765]);

 // A configuration may become stale during rendering. Even a completed real
 // payload must be discarded before it can leave the process.
 $render=new ReflectionMethod(App\Services\Actions\Client\ClientActions::class,'renderCurrentConfig');
 foreach(['expiry','group','uuid','token','deleted'] as $change) {
  $before=$u->fresh();
  $fields=match($change) {
   'expiry'=>['expired_at'=>time()], 'group'=>['group_id'=>98764],
   'uuid'=>['uuid'=>App\Utils\Helper::guid(true)], 'token'=>['token'=>App\Utils\Helper::guid()],
   'deleted'=>['account_deleted_at'=>time()],
  };
  $mutate=fn()=>DB::table('v2_user')->where('id',$u->id)->update($fields);
  $handler=new class($mutate,$before->uuid) {
   public function __construct(private Closure $mutate,private string $uuid){}
   public function handle(){($this->mutate)();return 'fixture-template-credential periodic.expiry.example.test '.$this->uuid;}
  };
  $race=Illuminate\Http\Request::create($public,'GET',['format'=>'flclash'],[],[],['HTTP_USER_AGENT'=>'FlClash/0.8.99']);
  $race->user=$before;$app->instance('request',$race);
  try {
   try {$response=$render->invoke($action,$handler,$before,98765,$race,'flclash');}
   catch(Illuminate\Http\Exceptions\HttpResponseException $error){$response=$error->getResponse();}
   if(in_array($change,['expiry','group'],true))$notice($response,$change==='expiry'?'expired':'subscription_changed');
   else $assert($response->getStatusCode()===403 && !$response->headers->has('X-Subscription-Notice') && !str_contains($response->getContent(),$before->uuid),'Identity rotation or deletion during rendering is a hard denial: '.$change);
  } finally {DB::table('v2_user')->where('id',$u->id)->update($before->only(['expired_at','group_id','uuid','token','account_deleted_at']));}
 }
 // Subscription middleware may have resolved a credential before a concurrent
 // rotation. Both public controllers must compare that ingress identity again.
 // Native clients use their authenticated account session rather than an old
 // subscription identity and may fetch the newly rotated configuration.
 foreach(['uuid','token'] as $field) {
  $before=$u->fresh();
  $replacement=$field==='uuid'?App\Utils\Helper::guid(true):App\Utils\Helper::guid();
  DB::table('v2_user')->where('id',$u->id)->update([$field=>$replacement]);
  try {
   foreach(['subscribe','application-config'] as $ingress) {
    $stale=Illuminate\Http\Request::create($public.($ingress==='application-config'?'/application-config':''),'GET',['format'=>'flclash'],[],[],['HTTP_USER_AGENT'=>'FlClash/0.8.99']);
    $stale->user=$before;$app->instance('request',$stale);
    try {$response=$ingress==='subscribe'?$action->subscribe($stale):(new App\Services\Actions\Client\AppActions())->getConfig($stale);}
    catch(Illuminate\Http\Exceptions\HttpResponseException $error){$response=$error->getResponse();}
    $assert($response->getStatusCode()===403 && !$response->headers->has('X-Subscription-Notice') && !str_contains($response->getContent(),$before->uuid),'An ingress snapshot cannot survive '.$field.' rotation in '.$ingress);
   }
   $nativeCurrent=$call($native,'application/json');
   $assert($nativeCurrent->getStatusCode()===200 && !$nativeCurrent->headers->has('X-Subscription-Notice') && str_contains($nativeCurrent->getContent(),'periodic.expiry.example.test'),'An existing native bearer session may fetch the current credentials after '.$field.' rotation');
   if($field==='uuid')$assert(str_contains($nativeCurrent->getContent(),$replacement) && !str_contains($nativeCurrent->getContent(),$before->uuid),'Native configuration uses only the newly rotated proxy UUID');
  } finally {DB::table('v2_user')->where('id',$u->id)->update($before->only(['uuid','token']));}
 }
 echo "Credit expiry: $checks checks passed; rollback.\n";
} finally {
 if($auth)$auth->removeAllSession();
 foreach($templates as $file=>$content){if($content===null)unlink($file);else file_put_contents($file,$content);}
 config(['v2board'=>$originalConfig]);
 DB::rollBack();
}
