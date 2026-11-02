<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\SubscribeLog;
$n=0;$assert = \Tests\Support\Assertions::counter($n);
DB::beginTransaction();
try {
 // This module exercises many HTTP policy combinations before its explicit
 // rate-limit case; keep those fixtures outside the ordinary request budget.
 config(['fastai.subscription_user_minute_limit'=>1000,'fastai.subscription_user_day_limit'=>1000,'fastai.subscription_ip_minute_limit'=>1000]);
 $service=new App\Services\ClientStrategyService();$service->syncStrategies();
 $user=App\Models\User::create(['email'=>Illuminate\Support\Str::uuid().'@example.com','password'=>'unused','uuid'=>(string)Illuminate\Support\Str::uuid(),'token'=>Illuminate\Support\Str::random(32),'plan_id'=>1,'group_id'=>98765,'transfer_enable'=>1073741824,'expired_at'=>time()+86400,'credit_balance'=>1073741824]);
 App\Models\ClientStrategy::whereIn('client_type',['mihomo','flclash','general'])->update(['is_enabled'=>1,'min_version'=>null]);
 config(['fastai.subscription_ua_whitelist_enabled'=>1,'fastai.subscription_ua_whitelist'=>['flclash']]);
 $call=function($ua,$format='flclash',$suffix='',$token=null)use($app,$user){
  $r=Illuminate\Http\Request::create('/api/v10/subscriptions/'.($token??$user->token).$suffix.($format===null?'':'?format='.$format),'GET',[],[],[],['HTTP_USER_AGENT'=>$ua,'REMOTE_ADDR'=>'192.0.2.'.($user->id % 240 + 10),'HTTP_ACCEPT'=>'application/yaml']);
  $app->instance('request',$r);
  return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($r);
 };
 $notice=function($response,string $reason)use($assert,$user) {
  $content=$response->getContent();$decoded=base64_decode(trim($content),true);if($decoded!==false)$content.="\n".$decoded;
  $assert($response->getStatusCode()===200 && $response->headers->get('X-Subscription-Notice')===$reason,'Known client policy failure returns an isolated warning: '.$reason);
  $assert(str_contains($content,'203.0.113.10'),'Policy notice uses a reserved dummy host');
  foreach([$user->uuid,$user->token,'node.example.test'] as $secret)$assert(!str_contains($content,$secret),'Policy notice excludes real subscription credentials');
  $assert(str_contains($response->headers->get('Cache-Control'),'no-store'),'Policy notice is private and non-cacheable');
 };
 $assert($call('FlClash/0.8.0','flclash&flag=meta')->getStatusCode()===422,'Old flag cannot coexist with format');
 $assert($call('FlClash/0.8.0','meta')->getStatusCode()===422,'Old format alias is retired');
 $r=$call('Mozilla/5.0','flclash');
 $assert($r->getStatusCode()===403,'Browser flag bypass blocked');
 $assert(str_contains($r->headers->get('Content-Type'),'application/problem+json'),'Problem contract');
 $assert(SubscribeLog::where('user_id',$user->id)->where('reason','client_ua_not_allowed')->exists(),'Blocked request logged');
 $assert($call('FlClash/0.8.0')->getStatusCode()===200,'Allowed UA with compatible format');
 $reportedFlclash = 'FlClash/v0.8.99 clash-verge Platform/wind';
 $assert($call($reportedFlclash,'flclash')->getStatusCode()===200,'Reported FlClash UA accepts its own format');
 $assert($call($reportedFlclash,'clash-verge')->getStatusCode()===200,'Reported FlClash UA accepts compatible Mihomo format');
 $assert($call($reportedFlclash,'sing-box')->getStatusCode()===422,'Reported FlClash UA cannot import sing-box JSON');
 App\Models\ClientStrategy::where('client_type','sing-box')->update(['is_enabled'=>1,'min_version'=>'1.14.3']);
 App\Models\ServerV2box::create([
  'group_id'=>[98765], 'name'=>'Policy test node', 'rate'=>'1',
  'host'=>'node.example.test', 'port'=>'443', 'server_port'=>443,
  'cipher'=>'aes-128-gcm', 'show'=>1, 'protocol'=>'shadowsocks',
  'tls'=>0, 'network'=>'tcp', 'up_mbps'=>0, 'down_mbps'=>0,
 ]);
 $sfw = $call('SFW (sing-box 1.14.3; language zh_CN)','sing-box');
 $assert($sfw->getStatusCode()===200,'Reported SFW UA accepts sing-box JSON: '.$sfw->getStatusCode().' '.(SubscribeLog::where('user_id',$user->id)->where('status','failed')->latest('id')->value('reason') ?? ''));
 $assert($service->accessDenial('sing-box','SFW (sing-box 1.14.2; language zh_CN)')==='client_version_too_low','Desktop shell still enforces kernel minimum');
 $assert($call('SFW (sing-box 1.14.3; language zh_CN)','flclash')->getStatusCode()===422,'SFW rejects Mihomo YAML');
 $assert(SubscribeLog::where('user_id',$user->id)->where('client_type','flclash')->exists(),'Stats use app identity');
 $assert($call('')->getStatusCode()===403,'Empty UA blocked');
 $assert($call('FlClash/0.8.0','general')->getStatusCode()===422,'General removed');
 $assert($call('FlClash/0.8.0','sing-box')->getStatusCode()===422,'Incompatible format rejected');
 $assert($call('Mozilla/5.0','flclash','/application-config')->getStatusCode()===403,'Legacy config cannot bypass whitelist');
 config(['fastai.subscription_ua_whitelist_enabled'=>0]);
 $assert($call('curl/8.0')->getStatusCode()===403,'Unknown UA remains blocked without whitelist');
 $invalid=$call('FlClash/0.8.0','flclash','',str_repeat('0',32));
 $assert(in_array($invalid->getStatusCode(),[401,403],true) && !$invalid->headers->has('X-Subscription-Notice'),'Invalid credentials remain an authentication failure, not a warning subscription');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['min_version'=>'0.9.0']);
 $notice($call('FlClash/0.8.0'),'client_version_too_low');
 $assert(SubscribeLog::where('user_id',$user->id)->where('reason','client_version_too_low')->exists(),'Format cannot bypass app minimum');
 try{$service->updateStrategies([['client_type'=>'flclash','min_version'=>'garbage 1.0']]);$assert(false,'Invalid minimum accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===422,'Invalid minimum rejected');}
 $notice($call('FlClash/0.8.0','flclash','/application-config'),'client_version_too_low');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['min_version'=>null,'is_enabled'=>0]);
 $assert($service->accessDenial('mihomo','FlClash/0.8.0')==='client_disabled','Disabled app cannot bypass via general format');
 $notice($call('FlClash/0.8.0'),'client_disabled');
 $notice($call('FlClash/0.8.0','flclash','/application-config'),'client_disabled');
 $disabledMismatch=$call('FlClash/0.8.0','sing-box');
 $assert($disabledMismatch->getStatusCode()===422 && !$disabledMismatch->headers->has('X-Subscription-Notice'),'Disabled client cannot use a notice to bypass format compatibility');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['is_enabled'=>1]);
 App\Models\ClientStrategy::where('client_type','mihomo')->update(['min_version'=>'1.19.0']);
 $assert($service->accessDenial('mihomo','FlClash/0.8.0 mihomo/1.18.0')==='client_version_too_low','Parent kernel policy applies');
 $assert($service->accessDenial('mihomo','FlClash/0.8.0 mihomo/1.20.0')===null,'Known compatible kernel accepted');
 $type='test-'.bin2hex(random_bytes(4));
 foreach([[time()-30,'success'],[time()-60,'failed'],[time()-86460,'success']] as [$at,$status]) SubscribeLog::create(['user_id'=>$user->id,'client_type'=>$type,'status'=>$status,'user_agent'=>'Test/1.0','created_at'=>$at,'updated_at'=>$at]);
 $statistics=app(App\Services\RiskStatisticsService::class);
 $row=$statistics->clientSubscriptionStats([['client_type'=>$type]])->first();
 $assert($row['subscribe_flag_count_24h']===2,'24 hour success and failure count');
 $assert($row['subscribe_flag_count_30d']===3,'30 day count');
 foreach (['flclash','fastai'] as $storedType) SubscribeLog::create(['user_id'=>$user->id,'client_type'=>$storedType,'status'=>'success','user_agent'=>'FastAI/89.77.66','created_at'=>time(),'updated_at'=>time()]);
 $stats=$statistics->clientSubscriptionStats([['client_type'=>'fastai'],['client_type'=>'flclash']])->keyBy('client_type');
 $sample=collect($stats['fastai']['raw_ua_stats'])->firstWhere('ua','FastAI/89.77.66');
 $assert($sample && $sample['count_24h']===2 && $sample['version']==='89.77.66','Current and historical FastAI UA counts merge into FastAI');
 $assert(!in_array('FastAI/89.77.66',$stats['flclash']['raw_ua_list']),'FastAI UA observations no longer appear in FlClash');
 $edgeType='edge-'.bin2hex(random_bytes(4));$edgeNow=time();
 foreach([[-100,$edgeType,'First/1.0'],[-200,$edgeType,'First/1.0'],[-2*86400,$edgeType,'Second/2.0'],[-10*86400,$edgeType,''],[-12*86400,$edgeType,null],[-40*86400,$edgeType,'Expired/1.0'],[-100,strtoupper(' '.$edgeType.' '),'First/1.0']] as [$offset,$storedType,$ua]) {
  SubscribeLog::create(['user_id'=>$user->id,'client_type'=>$storedType,'user_agent'=>$ua,'status'=>'failed','created_at'=>$edgeNow+$offset,'updated_at'=>$edgeNow+$offset]);
 }
 DB::enableQueryLog();DB::flushQueryLog();
 try {
  $edge=$statistics->clientSubscriptionStats([['client_type'=>$edgeType]])->first();
  $statsReads=count(array_filter(DB::getQueryLog(),fn($q)=>str_contains($q['query'],'v2_subscribe_log')));
 } finally {DB::disableQueryLog();}
 $assert($edge['subscribe_flag_count_24h']===3 && $edge['subscribe_flag_count_30d']===6,'Flag totals retain missing UAs and normalized client labels');
 $assert($edge['subscribe_ua_unique_count_24h']===1 && $edge['subscribe_ua_unique_count_30d']===2,'Unique UA windows exclude missing values and preserve distinct grouping');
 $assert($edge['top_raw_ua']==='First/1.0' && $edge['top_raw_ua_count']===3 && $edge['raw_ua_list']===['First/1.0','Second/2.0'],'Raw UA ranking and ordering are unchanged');
 $assert($edge['raw_ua_stats'][1]['count_24h']===0 && $edge['raw_ua_stats'][1]['count_30d']===1,'Older observations do not count as current requests');
 // SQL collation, empty input and unobserved strategies must retain the old statistics semantics.
 $caseType='case-'.bin2hex(random_bytes(4));
 foreach ([['Example/1.0',-2*86400],['example/1.0',-100]] as [$ua,$offset]) {
  SubscribeLog::create(['user_id'=>$user->id,'client_type'=>$caseType,'user_agent'=>$ua,'status'=>'success','created_at'=>$edgeNow+$offset,'updated_at'=>$edgeNow+$offset]);
 }
 $case=$statistics->clientSubscriptionStats([['client_type'=>$caseType]])->first();
 $assert($case['subscribe_flag_count_24h']===1 && $case['subscribe_flag_count_30d']===2,'Collated UA groups retain request windows');
 $assert($case['subscribe_ua_unique_count_24h']===1 && $case['subscribe_ua_unique_count_30d']===1 && count($case['raw_ua_stats'])===1,'UA distinct counts use SQL collation');
 $assert($case['raw_ua_stats'][0]['count_24h']===1 && $case['raw_ua_stats'][0]['count_30d']===2,'Current and older collated UA requests merge');
 $missing=$statistics->clientSubscriptionStats([['client_type'=>'missing-'.bin2hex(random_bytes(4))]])->first();
 $assert($missing['subscribe_flag_count_24h']===0 && $missing['subscribe_ua_unique_count_30d']===0 && $missing['raw_ua_stats']===[] && $missing['ua_last_seen_at']===null && $missing['ua_version_coverage_24h']==='暂无请求','Unobserved strategies have complete zero defaults');
 DB::enableQueryLog();DB::flushQueryLog();
 try {
  $assert($statistics->clientSubscriptionStats([])->isEmpty() && DB::getQueryLog()===[],'Empty strategy lists do not scan logs');
 } finally {DB::disableQueryLog();}

 $assert($call('FastAI/1.0.0','fastai')->getStatusCode()===422,'FastAI format cannot bypass native session authentication');
 $assert($call('FlClash/0.8.0','FlClash/0.8.0')->getStatusCode()===422,'Explicit format is not a UA');
 $notice($call('Throne/1.3.2','throne'),'client_disabled');
 $service->updateStrategies([['client_type'=>'throne','is_enabled'=>true]]);
 $assert($call('Throne/1.3.2','v2rayn')->getStatusCode()===200,'Enabled new client uses shared URI renderer');
 $assert(SubscribeLog::where('user_id',$user->id)->where('client_type','throne')->where('status','success')->exists(),'Shared renderer retains actual UA identity in logs');
 // A nonempty server catalog may still contain no node supported by a list
 // renderer. STATUS lines are metadata, not proof of an importable proxy.
 $service->updateStrategies([
  ['client_type'=>'quantumult-x','is_enabled'=>true,'min_version'=>null],
  ['client_type'=>'shadowrocket','is_enabled'=>true,'min_version'=>null],
  ['client_type'=>'shadowsocks','is_enabled'=>true,'min_version'=>null],
 ]);
 config(['fastai.show_info_to_server_enable'=>0]);
 $qx=$call('Quantumult X/1.5.0','quantumult-x');
 $qxBody=base64_decode($qx->getContent(),true);
 $assert($qx->getStatusCode()===200 && !$qx->headers->has('X-Subscription-Notice') && str_contains($qxBody?:'','node.example.test') && str_contains($qxBody?:'',$user->uuid),'Supported QX nodes remain real output rather than an empty-list warning');
 $rocket=$call('Shadowrocket/2.2.0','shadowrocket');
 $rocketBody=base64_decode($rocket->getContent(),true);
 $assert($rocket->getStatusCode()===200 && !$rocket->headers->has('X-Subscription-Notice') && str_contains($rocketBody?:'','node.example.test'),'Shadowrocket with a supported node remains a real subscription despite its STATUS metadata');
 $sip=$call('Shadowsocks/1.0.0','shadowsocks');
 $sipBody=json_decode($sip->getContent(),true,512,JSON_THROW_ON_ERROR);
 $assert($sip->getStatusCode()===200 && !$sip->headers->has('X-Subscription-Notice') && count($sipBody['servers']??[])===1
  && $sipBody['servers'][0]['server']==='node.example.test' && $sipBody['servers'][0]['password']===$user->uuid,'SIP008 unwraps V2Box Shadowsocks nodes and exports the correct real proxy UUID');
 $oldGroup=$user->group_id;
 try {
  App\Models\ServerV2box::create(['group_id'=>[98764],'name'=>'QX unsupported transport','host'=>'grpc-only.example.test','port'=>'443','server_port'=>443,
   'protocol'=>'vmess','show'=>1,'rate'=>1,'tls'=>1,'network'=>'grpc','network_settings'=>['serviceName'=>'policy-fixture'],'up_mbps'=>0,'down_mbps'=>0]);
  $user->group_id=98764;$user->save();
  $assert(count((new App\Services\ServerService())->getAvailableServers($user->fresh()))===1,'QX negative fixture has one authorized catalog node');
  $qx=$call('Quantumult X/1.5.0','quantumult-x');$notice($qx,'no_available_nodes');
  $assert(!str_contains(base64_decode($qx->getContent(),true)?:'','grpc-only.example.test'),'A filtered gRPC node cannot survive in QX output');
   $naiveNode=App\Models\ServerV2box::create(['group_id'=>[98763],'name'=>'Shadowrocket Naive-only','host'=>'naive-only.example.test','port'=>'443','server_port'=>443,
   'protocol'=>'naive','show'=>1,'rate'=>1,'tls'=>1,'network'=>'tcp','tls_settings'=>['cert_mode'=>'http','server_name'=>'naive-sni.example.test'],'up_mbps'=>0,'down_mbps'=>0]);
  $user->group_id=98763;$user->save();
  $assert(count((new App\Services\ServerService())->getAvailableServers($user->fresh()))===1,'Shadowrocket Naive-only fixture has one authorized node');
  $rocket=$call('Shadowrocket/2.2.0','shadowrocket');
  $rocketBody=base64_decode($rocket->getContent(),true)?:'';
  $assert($rocket->getStatusCode()===200 && !$rocket->headers->has('X-Subscription-Notice'),'A Naive-only Shadowrocket subscription remains real usable output');
  $assert(preg_match('/^http2:\/\/([^?#\r\n]+)\?([^#\r\n]*)#/m',$rocketBody,$naiveParts)===1,'Naive-only HTTP subscription contains a Shadowrocket HTTP2 proxy');
  $assert(base64_decode($naiveParts[1],true)===rawurlencode($user->uuid).':'.rawurlencode($user->uuid).'@naive-only.example.test:443','Naive-only HTTP subscription retains the real user and endpoint');
  parse_str($naiveParts[2],$naiveQuery);
  $assert($naiveQuery===['peer'=>'naive-sni.example.test','alpn'=>'h2','padding'=>'1'],'Naive-only HTTP subscription carries SNI, HTTP2 and mandatory padding');
   $nekoUa='NekoBox/Android/1.4.0 (Prefer ClashMeta Format)';
   $notice($call($nekoUa,null),'client_disabled');
   $service->updateStrategies(array_map(fn($client)=>['client_type'=>$client,'is_enabled'=>true,'min_version'=>null],
    ['mihomo','nekobox','husi','throne','v2rayn','v2rayng','v2raytun','passwall','sagernet','ssr-plus','sing-box']));
   foreach([
    ['v2rayN/7.25.6','v2rayn'],['Throne/1.3.2','throne'],['husi/2.3.4','husi'],
    [$nekoUa,null],[$nekoUa,'v2rayn'],['Passwall/26.10.29','passwall'],
   ] as [$ua,$format]) {
    $response=$call($ua,$format);$body=base64_decode($response->getContent(),true)?:'';
    $assert($response->getStatusCode()===200 && !$response->headers->has('X-Subscription-Notice')
     && str_contains($body,'naive+https://'.$user->uuid.':'.$user->uuid.'@naive-only.example.test:443?sni=naive-sni.example.test#'),
     'Verified URI clients retain a real Naive node selected by their actual UA: '.$ua);
   }
   $assert(SubscribeLog::where('user_id',$user->id)->where('client_type','nekobox')->where('status','success')->exists(),'NekoBox URI output retains its application identity in request logs');
   foreach([['sing-box/1.14.3','sing-box'],['Hiddify/4.1.1',null]] as [$ua,$format]) {
    $sing=$call($ua,$format);$singBody=json_decode($sing->getContent(),true,512,JSON_THROW_ON_ERROR);
    $singNodes=array_values(array_filter($singBody['outbounds']??[],fn($row)=>($row['type']??null)==='naive'));
    $assert($sing->getStatusCode()===200 && !$sing->headers->has('X-Subscription-Notice') && count($singNodes)===1
     && $singNodes[0]['server']==='naive-only.example.test' && $singNodes[0]['username']===$user->uuid
     && $singNodes[0]['password']===$user->uuid && $singNodes[0]['tls']['server_name']==='naive-sni.example.test','The verified sing-box client retains a Naive outbound with independent SNI: '.$ua);
   }
   foreach([['v2rayNG/2.3.14','v2rayng'],['v2rayNG/2.3.14','v2rayn'],['v2RayTun/5.26.83','v2raytun'],['SSRPlus/198.2','ssr-plus']] as [$ua,$format]) {
    $response=$call($ua,$format);$notice($response,'no_available_nodes');
    $body=$response->getContent().(base64_decode($response->getContent(),true)?:'');
    $assert(!str_contains($body,'naive-only.example.test'),'An unverified Naive importer cannot gain the real endpoint by choosing another format: '.$ua.' '.$format);
   }
   $filteredYaml=$call('FlClash/0.8.0','flclash');$filteredBody=$filteredYaml->getContent();
   $filteredConfig=Symfony\Component\Yaml\Yaml::parse($filteredBody);
   $assert($filteredYaml->getStatusCode()===200 && !str_contains($filteredBody,'naive-only.example.test') && !str_contains($filteredBody,'naive-sni.example.test')
    && !array_filter($filteredConfig['proxies']??[],fn($row)=>($row['type']??null)==='naive'),'Filtering Naive from a full YAML template preserves its existing fallback without exposing a fake or incompatible Naive node');
   $notice($call('SagerNet/0.8.1','sagernet'),'no_available_nodes');
   $naiveNode->tls_settings=['cert_mode'=>'http','server_name'=>'NAIVE-ONLY.EXAMPLE.TEST.'];$naiveNode->save();
   $sager=$call('SagerNet/0.8.1','sagernet');$sagerBody=base64_decode($sager->getContent(),true)?:'';
   $assert($sager->getStatusCode()===200 && !$sager->headers->has('X-Subscription-Notice') && str_contains($sagerBody,'@naive-only.example.test:443?'),'SagerNet may receive Naive when the TLS identity is the same connection hostname');
   $naiveNode->tls_settings=['cert_mode'=>'http','server_name'=>'naive-sni.example.test'];$naiveNode->save();
   $service->updateStrategies([['client_type'=>'nekobox','min_version'=>'2.0.0']]);
   $notice($call($nekoUa,null),'client_version_too_low');
   $notice($call($nekoUa,'mihomo'),'client_version_too_low');
   $service->updateStrategies([['client_type'=>'nekobox','min_version'=>null],['client_type'=>'mihomo','min_version'=>'1.20.0']]);
   $notice($call($nekoUa,null),'client_version_too_low');
   $notice($call($nekoUa,'mihomo'),'client_version_too_low');
   $withKernel=$call($nekoUa.' mihomo/1.21.0',null);
   $assert($withKernel->getStatusCode()===200 && !$withKernel->headers->has('X-Subscription-Notice'),'NekoBox URI default still accepts an explicitly recognized compatible parent kernel');
   $service->updateStrategies([['client_type'=>'mihomo','min_version'=>null]]);
   $assert($call('FlClash/0.8.0','nekobox')->getStatusCode()===422,'A Mihomo client cannot use NekoBox as a reverse URI-format bypass');
   $assert($call($nekoUa,'sing-box')->getStatusCode()===422,'NekoBox URI support does not permit a full sing-box configuration');
   App\Models\ServerV2box::create(['group_id'=>[98763],'name'=>'Mixed supported Shadowsocks','host'=>'mixed-supported.example.test','port'=>'443','server_port'=>443,
    'protocol'=>'shadowsocks','cipher'=>'aes-128-gcm','show'=>1,'rate'=>1,'tls'=>0,'network'=>'tcp','up_mbps'=>0,'down_mbps'=>0]);
   foreach([['v2rayNG/2.3.14','v2rayn'],['SagerNet/0.8.1','sagernet']] as [$ua,$format]) {
    $response=$call($ua,$format);$body=base64_decode($response->getContent(),true)?:'';
    $assert($response->getStatusCode()===200 && !$response->headers->has('X-Subscription-Notice') && str_contains($body,'mixed-supported.example.test:443')
     && !str_contains($body,'naive-only.example.test'),'Naive capability filtering preserves other supported nodes: '.$ua);
   }
   $legacy=$call($nekoUa,'mihomo');$legacyBody=Symfony\Component\Yaml\Yaml::parse($legacy->getContent());
   $assert($legacy->getStatusCode()===200 && !$legacy->headers->has('X-Subscription-Notice')
    && count(array_filter($legacyBody['proxies']??[],fn($row)=>($row['server']??null)==='mixed-supported.example.test' && ($row['password']??null)===$user->uuid))===1,
    'Existing NekoBox Mihomo-format links retain their supported real nodes');
   $activeUntil=$user->expired_at;
   try {
    DB::table('v2_user')->where('id',$user->id)->update(['expired_at'=>time()-1,'credit_balance'=>0]);
    $notice($call($nekoUa,null),'expired');
    $notice($call($nekoUa,'mihomo'),'expired');
   } finally {DB::table('v2_user')->where('id',$user->id)->update(['expired_at'=>$activeUntil,'credit_balance'=>$user->getRawOriginal('credit_balance')]);}
  // Deliberately bypass admin validation to exercise unsupported-renderer safety.
  App\Models\ServerV2box::create(['group_id'=>[98762],'name'=>'Shadowrocket unsupported future protocol','host'=>'unsupported-only.example.test','port'=>'443','server_port'=>443,
   'protocol'=>'future-protocol','show'=>1,'rate'=>1,'tls'=>0,'network'=>'tcp','up_mbps'=>0,'down_mbps'=>0]);
  $user->group_id=98762;$user->save();
  $assert(count((new App\Services\ServerService())->getAvailableServers($user->fresh()))===1,'Unsupported-renderer fixture still has one authorized catalog node');
  $rocket=$call('Shadowrocket/2.2.0','shadowrocket');$notice($rocket,'no_available_nodes');
  $rocketBody=base64_decode($rocket->getContent(),true)?:'';
  $assert(!str_contains($rocketBody,'STATUS=') && !str_contains($rocketBody,'unsupported-only.example.test'),'Unsupported STATUS-only Shadowrocket output is still replaced by a safe warning node');
 } finally {$user->group_id=$oldGroup;$user->save();}
 config(['fastai.subscription_user_minute_limit'=>1]);
 $limited=$call('FlClash/0.8.0');
 $assert($limited->getStatusCode()===429 && (int)$limited->headers->get('Retry-After')>0,'HTTP rate limit and retry header');
 $assert(!$limited->headers->has('X-Subscription-Notice'),'Rate limits cannot become HTTP 200 notice subscriptions');
 $assert(json_decode($limited->getContent(),true)['code']==='RATE_LIMITED','Rate limit problem schema');
 $assert($call('FlClash/0.8.0','flclash','/application-version')->getStatusCode()===429,'Account rate shared by version endpoint');
 $assert($statsReads<=2,'Client statistics use at most two log scans');
 echo "Client statistics queries: $statsReads\n";
 echo "Subscription policy integration: {$n} checks passed\n";
} finally {DB::rollBack();}
