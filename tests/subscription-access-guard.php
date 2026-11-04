<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\DB;
use App\Services\SubscriptionAccessGuard;
use App\Services\RiskBlacklistService;
use App\Models\SubscribeLog;
use App\Models\RiskRuleHit;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
use App\Services\OneTimeSubscriptionToken;
if (($argv[1] ?? '') === 'one-time-worker') {
 try { OneTimeSubscriptionToken::consume($argv[2]); echo 'redeemed'; }
 catch (HttpException $error) { echo (string)$error->getStatusCode(); }
 exit;
}
$guard=new SubscriptionAccessGuard();
$id=random_int(100000000,999999999);$ip='198.18.'.random_int(0,255).'.'.random_int(1,254);
$keys=['user-minute'=>"$id",'user-day'=>"$id",'ip'=>$ip];
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
$denied=function($run,$status)use($assert){try{$run();throw new RuntimeException('Expected rejection');}catch(HttpException $e){$assert($e->getStatusCode()===$status,'Correct rejection');if($status===429)$assert((int)($e->getHeaders()['Retry-After']??0)>0,'Retry-After present');}};
DB::beginTransaction();
try {
 config(['fastai.subscription_user_minute_limit'=>100,'fastai.subscription_user_day_limit'=>2,'fastai.subscription_ip_minute_limit'=>2]);
 $guard->checkUser($id);$guard->checkUser($id);$denied(fn()=>$guard->checkUser($id),429);
 $r=Request::create('/','GET',[],[],[],['REMOTE_ADDR'=>$ip,'HTTP_USER_AGENT'=>'FlClash/0.8.0']);
 $guard->checkIp($r);$guard->checkIp($r);$denied(fn()=>$guard->checkIp($r),429);
 RateLimiter::clear('subscription-access:ip:'.hash('sha256',$ip));
 App\Models\RiskBlacklistIp::create(['value'=>$ip,'is_enabled'=>1]);
 $denied(fn()=>$guard->checkIp($r),403);
 $ipLog=SubscribeLog::where('ip',$ip)->where('reason','subscription_ip_blacklisted')->first();
 $assert($ipLog && $ipLog->status==='failed' && $ipLog->user_id===null && $ipLog->user_agent===null,
  'The early IP rejection is visible without identifying an unauthenticated user');
 App\Models\RiskBlacklistIp::where('value',$ip)->delete();
 RateLimiter::clear('subscription-access:ip:'.hash('sha256',$ip));
 $controller=new App\Http\Controllers\V1\Risk\LogController();
 $blacklist=new RiskBlacklistService();
 $saveIp=fn(array $data)=>json_decode($controller->updateIpBlacklist(Request::create('/','POST',$data))->getContent(),true)['data'];
 $saveUa=fn(array $data)=>json_decode($controller->updateUaBlacklist(Request::create('/','POST',$data))->getContent(),true)['data'];
 $octets=explode('.',$ip);
 $range=implode('.',array_slice($octets,0,3)).'.0/24';
 $outside='198.18.'.(((int)$octets[2]+1)%256).'.40';
 $row=collect($saveIp(['value'=>$ip.'/24','reason'=>'temporary network','expired_at'=>time()+60]))->firstWhere('value',$range);
 $assert($row && $row['remark']==='temporary network' && $row['expires_at']>time()
  && $blacklist->exists('ip',$ip) && !$blacklist->exists('ip',$outside),'IPv4 CIDR and legacy metadata fields are effective');
 $saveIp(['id'=>$row['id'],'value'=>'2001:db8:ab::8/48','expires_at'=>time()-1]);
 $assert(!$blacklist->exists('ip',$ip) && !$blacklist->exists('ip','2001:db8:ab::abcd')
  && collect($blacklist->fetch('ip'))->firstWhere('id',$row['id'])['value']==='2001:db8:ab::/48',
  'Editing the same row left an old block or ignored IPv6 expiry');
 $saveIp(['id'=>$row['id'],'value'=>'2001:db8:ab::/48','expires_at'=>null]);
 $assert($blacklist->exists('ip','2001:db8:ab::abcd') && !$blacklist->exists('ip','2001:db8:ac::abcd'),
  'Clearing expiry restores only the intended IPv6 subnet');
 $denied(fn()=>$saveIp(['value'=>'203.0.113.9/33']),422);
 $denied(fn()=>$saveIp(['id'=>'ua_hash:1','value'=>'203.0.113.9']),422);

 $oldUa='FixtureUA/previous-'.$id;
 $secret='private-fixture-subscription-'.$id;
 $newUa='FixtureUA/'.$secret;
 $oldHash=hash('sha256',$oldUa);
 $newHash=hash('sha256',$newUa);
 $ua=collect($saveUa(['ua_raw'=>$oldUa,'reason'=>'test UA policy']))->firstWhere('value',$oldHash);
 $updatedUa=collect($saveUa(['id'=>$ua['id'],'value'=>$oldHash,'ua_raw'=>$newUa]))->firstWhere('id',$ua['id']);
 $assert($updatedUa['value']===$newHash && $updatedUa['remark']==='test UA policy'
  && !$blacklist->exists('ua_hash',$oldHash),'Editing the UA must replace the old hash and preserve unrelated metadata');
 $request=Request::create('/api/v10/subscriptions/'.$secret,'GET',[],[],[],['REMOTE_ADDR'=>$ip,'HTTP_USER_AGENT'=>$newUa]);
 $denied(fn()=>$guard->checkIp($request),403);
 $log=SubscribeLog::where('ip',$ip)->where('reason','subscription_ua_blacklisted')->latest('id')->first();
 $hit=RiskRuleHit::where('ip',$ip)->where('rule_key','subscribe_ua_hash_blacklist_hit')->latest('id')->first();
 $assert($log && $log->user_id===null && $log->user_agent===null && $log->ua_hash===$newHash
  && $hit && $hit->status==='blocked' && $hit->payload['source_log_id']===$log->id
  && !str_contains($log->toJson().$hit->toJson(),$secret),'Early UA denial did not record a redacted and linked risk event');
 $accountToken = bin2hex(random_bytes(32));
 $once = OneTimeSubscriptionToken::issue($accountToken);
 $assert(OneTimeSubscriptionToken::issue($accountToken)===$once, 'Unused links retain the same one-time token');
 $workers=[];
 for ($i=0; $i<2; $i++) {
  $pipes=[];
  $worker=proc_open([PHP_BINARY, __FILE__, 'one-time-worker', $once], [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']], $pipes);
  if (!is_resource($worker)) throw new RuntimeException('Unable to start subscription consumer');
  fclose($pipes[0]);
  $workers[]=[$worker,$pipes];
 }
 $results=[];
 foreach ($workers as [$worker,$pipes]) {
  $results[]=stream_get_contents($pipes[1]);
  $error=stream_get_contents($pipes[2]);
  fclose($pipes[1]); fclose($pipes[2]);
  $assert(proc_close($worker)===0, 'Subscription consumer failed: '.$error);
 }
 sort($results);
 $assert($results===['403','redeemed'], 'Only one concurrent worker may redeem a one-time link');
 $fresh = OneTimeSubscriptionToken::issue($accountToken);
 $assert($fresh!==$once && OneTimeSubscriptionToken::consume($fresh)===$accountToken, 'A new link must be issued after consumption');
 echo "Subscription access guard: {$checks} checks passed\n";
} finally {
 DB::rollBack();
 foreach($keys as $scope=>$value)RateLimiter::clear('subscription-access:'.$scope.':'.hash('sha256',$value));
}
