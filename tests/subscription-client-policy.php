<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\SubscribeLog;
$n=0;$assert=function($ok,$label)use(&$n){if(!$ok)throw new RuntimeException($label);$n++;};
DB::beginTransaction();
try {
 $service=new App\Services\ClientStrategyService();$service->syncStrategies();
 $user=App\Models\User::create(['email'=>Illuminate\Support\Str::uuid().'@example.com','password'=>'unused','uuid'=>(string)Illuminate\Support\Str::uuid(),'token'=>Illuminate\Support\Str::random(32),'plan_id'=>1,'group_id'=>98765,'transfer_enable'=>1073741824,'expired_at'=>time()+86400,'credit_balance'=>1073741824]);
 App\Models\ClientStrategy::whereIn('client_type',['mihomo','flclash','general'])->update(['is_enabled'=>1,'min_version'=>null]);
 config(['v2board.subscription_ua_whitelist_enabled'=>1,'v2board.subscription_ua_whitelist'=>['flclash']]);
 $call=function($ua,$format='flclash',$suffix='')use($app,$user){
  $r=Illuminate\Http\Request::create('/api/v10/subscriptions/'.$user->token.$suffix.'?format='.$format,'GET',[],[],[],['HTTP_USER_AGENT'=>$ua,'REMOTE_ADDR'=>'192.0.2.'.($user->id % 240 + 10),'HTTP_ACCEPT'=>'application/yaml']);
  $app->instance('request',$r);
  return $app->make(Illuminate\Contracts\Http\Kernel::class)->handle($r);
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
 App\Models\ServerV2node::create([
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
 config(['v2board.subscription_ua_whitelist_enabled'=>0]);
 $assert($call('curl/8.0')->getStatusCode()===403,'Unknown UA remains blocked without whitelist');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['min_version'=>'0.9.0']);
 $call('FlClash/0.8.0');
 $assert(SubscribeLog::where('user_id',$user->id)->where('reason','client_version_too_low')->exists(),'Format cannot bypass app minimum');
 try{$service->updateStrategies([['client_type'=>'flclash','min_version'=>'garbage 1.0']]);$assert(false,'Invalid minimum accepted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===422,'Invalid minimum rejected');}
 $assert($call('FlClash/0.8.0','flclash','/application-config')->getStatusCode()===403,'Legacy config respects app minimum');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['min_version'=>null,'is_enabled'=>0]);
 $assert($service->accessDenial('mihomo','FlClash/0.8.0')==='client_disabled','Disabled app cannot bypass via general format');
 $assert($call('FlClash/0.8.0')->getStatusCode()===403,'Disabled client gets HTTP 403');
 App\Models\ClientStrategy::where('client_type','flclash')->update(['is_enabled'=>1]);
 App\Models\ClientStrategy::where('client_type','mihomo')->update(['min_version'=>'1.19.0']);
 $assert($service->accessDenial('mihomo','FlClash/0.8.0 mihomo/1.18.0')==='client_version_too_low','Parent kernel policy applies');
 $assert($service->accessDenial('mihomo','FlClash/0.8.0 mihomo/1.20.0')===null,'Known compatible kernel accepted');
 $type='test-'.bin2hex(random_bytes(4));
 foreach([[time()-30,'success'],[time()-60,'failed'],[time()-86460,'success']] as [$at,$status]) SubscribeLog::create(['user_id'=>$user->id,'client_type'=>$type,'status'=>$status,'user_agent'=>'Test/1.0','created_at'=>$at,'updated_at'=>$at]);
 $m=new ReflectionMethod(App\Http\Controllers\V1\Risk\LogController::class,'appendClientSubscribeStats');$m->setAccessible(true);
 $row=$m->invoke(new App\Http\Controllers\V1\Risk\LogController(),[['client_type'=>$type]])->first();
 $assert($row['subscribe_flag_count_24h']===2,'24 hour success and failure count');
 $assert($row['subscribe_flag_count_30d']===3,'30 day count');
 $assert($call('FlClash/0.8.0','FlClash/0.8.0')->getStatusCode()===422,'Explicit format is not a UA');
 $assert($call('Throne/1.3.2','throne')->getStatusCode()===403,'New client is denied before opt-in');
 $service->updateStrategies([['client_type'=>'throne','is_enabled'=>true]]);
 $assert($call('Throne/1.3.2','v2rayn')->getStatusCode()===200,'Enabled new client uses shared URI renderer');
 $assert(SubscribeLog::where('user_id',$user->id)->where('client_type','throne')->where('status','success')->exists(),'Shared renderer retains actual UA identity in logs');
 config(['v2board.subscription_user_minute_limit'=>1]);
 $limited=$call('FlClash/0.8.0');
 $assert($limited->getStatusCode()===429 && (int)$limited->headers->get('Retry-After')>0,'HTTP rate limit and retry header');
 $assert(json_decode($limited->getContent(),true)['code']==='RATE_LIMITED','Rate limit problem schema');
 $assert($call('FlClash/0.8.0','flclash','/application-version')->getStatusCode()===429,'Account rate shared by version endpoint');
 echo "Subscription policy integration: {$n} checks passed\n";
} finally {DB::rollBack();}
