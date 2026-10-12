<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\DB;
use App\Services\SubscriptionAccessGuard;
use Symfony\Component\HttpKernel\Exception\HttpException;
$guard=new SubscriptionAccessGuard();
$id=random_int(100000000,999999999);$ip='198.18.'.random_int(0,255).'.'.random_int(1,254);
$keys=['user-minute'=>"$id",'user-day'=>"$id",'ip'=>$ip];
$checks=0;$assert=function($ok,$label)use(&$checks){if(!$ok)throw new RuntimeException($label);$checks++;};
$denied=function($run,$status)use($assert){try{$run();throw new RuntimeException('Expected rejection');}catch(HttpException $e){$assert($e->getStatusCode()===$status,'Correct rejection');if($status===429)$assert((int)($e->getHeaders()['Retry-After']??0)>0,'Retry-After present');}};
DB::beginTransaction();
try {
 config(['v2board.subscription_user_minute_limit'=>100,'v2board.subscription_user_day_limit'=>2,'v2board.subscription_ip_minute_limit'=>2]);
 $guard->checkUser($id);$guard->checkUser($id);$denied(fn()=>$guard->checkUser($id),429);
 $r=Illuminate\Http\Request::create('/','GET',[],[],[],['REMOTE_ADDR'=>$ip,'HTTP_USER_AGENT'=>'FlClash/0.8.0']);
 $guard->checkIp($r);$guard->checkIp($r);$denied(fn()=>$guard->checkIp($r),429);
 RateLimiter::clear('subscription-access:ip:'.hash('sha256',$ip));
 App\Models\RiskBlacklistIp::create(['value'=>$ip,'is_enabled'=>1]);
 $denied(fn()=>$guard->checkIp($r),403);
 App\Models\RiskBlacklistIp::where('value',$ip)->delete();
 RateLimiter::clear('subscription-access:ip:'.hash('sha256',$ip));
 App\Models\RiskBlacklistUaHash::updateOrCreate(['value'=>hash('sha256','FlClash/0.8.0')],['is_enabled'=>1]);
 $denied(fn()=>$guard->checkIp($r),403);
 echo "Subscription access guard: {$checks} checks passed\n";
} finally {
 DB::rollBack();
 foreach($keys as $scope=>$value)RateLimiter::clear('subscription-access:'.$scope.':'.hash('sha256',$value));
}
