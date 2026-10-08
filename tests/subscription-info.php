<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Services\SubscriptionInfo;
$checks = 0;
$assert = function ($ok, $message) use (&$checks) {if (!$ok) throw new RuntimeException($message); $checks++;};
$enabled = config('v2board.show_info_to_server_enable');
$locale = app()->getLocale();
DB::beginTransaction();
try {
    $user = App\Models\User::create(['email'=>'info-'.bin2hex(random_bytes(6)).'@example.com','password'=>password_hash('fixture-password',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'credit_balance'=>30*1073741824]);
    DB::table('v2_credit_batch')->insert(['user_id'=>$user->id,'reference'=>'info-expired','remaining_bytes'=>10*1073741824,'expires_at'=>time()-60,'created_at'=>time()]);
    foreach ([[2,time()+3600],[5,time()-60],[0,null]] as $batch=>[$remaining,$expires]) DB::table('v2_usage_reset_credit')->insert(['batch_id'=>$batch+1,'user_id'=>$user->id,'quantity'=>max(1,$remaining),'remaining'=>$remaining,'expires_at'=>$expires,'created_at'=>time()]);
    config(['v2board.show_info_to_server_enable'=>1]);
    $plan = App\Models\Plan::firstOrFail()->replicate();
    $plan->reset_traffic_method = 0;
    $plan->save();
    $user->plan_id = $plan->id;
    $user->transfer_enable = 1073741824;
    $user->expired_at = time()+90*86400;
    $resetAt = (new App\Services\UserService())->getResetAt($user);
    $resetDate = Carbon\Carbon::createFromTimestamp($resetAt, config('app.timezone', 'UTC'))->format('m-d');
    foreach (require resource_path('client/copy.php') as $language=>$copy) {
        app()->setLocale($language);
        $lines = SubscriptionInfo::lines($user);
        $assert($lines === [$copy['next_reset'].': '.$resetDate,$copy['independent'].': '.App\Utils\Helper::trafficConvert(20*1073741824),$copy['reset_count'].': '.sprintf($copy['reset_quantity'],2)], 'Wrong effective credits or locale '.$language);
    }
    $controller = new App\Services\Actions\Client\ClientActions();
    $method = new ReflectionMethod($controller,'setSubscribeInfoToServers'); $method->setAccessible(true);
    $servers = [['name'=>'Real node','type'=>'vmess']];
    $method->invokeArgs($controller,[&$servers,$user]);
    $assert(count($servers)===4 && end($servers)['name']==='Real node','Supplementary nodes must preserve real nodes');
    $user->credit_balance = 0;
    DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->update(['remaining'=>0]);
    $assert(count(SubscriptionInfo::lines($user))===1, 'Automatic reset must show without manual reset credits');
    $plan->reset_traffic_method = 2;
    $plan->save();
    $assert(SubscriptionInfo::lines($user)===[], 'Non-resetting plan must omit reset date');
    $plan->reset_traffic_method = 0;
    $plan->save();
    $user->expired_at = time()-60;
    $assert(SubscriptionInfo::lines($user)===[], 'Expired plan must omit reset date');
    $user->plan_id = null;
    $assert(SubscriptionInfo::lines($user)===[], 'Zero balances should be omitted');
    config(['v2board.show_info_to_server_enable'=>0]);
    $user->credit_balance = 1073741824;
    $assert(SubscriptionInfo::lines($user)===[], 'Disabled output must stay empty');
    echo "Subscription info: $checks checks passed\n";
} finally {
    DB::rollBack();
    config(['v2board.show_info_to_server_enable'=>$enabled]);
    app()->setLocale($locale);
}
