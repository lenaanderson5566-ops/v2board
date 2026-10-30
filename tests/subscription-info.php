<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Services\SubscriptionInfo;
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$enabled = config('v2board.show_info_to_server_enable');
$locale = app()->getLocale();
$timezone = config('app.timezone');
$businessTimezone = config('v2board.system_timezone');
$phpTimezone = date_default_timezone_get();
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
    config(['app.timezone'=>'Asia/Shanghai', 'v2board.system_timezone'=>'Asia/Shanghai']);
    date_default_timezone_set('Asia/Shanghai');
    DB::table('v2_daily_user_reset')->insert(['user_id'=>$user->id,'business_date'=>date('Y-m-d')]);
    $resetAt = (new App\Services\UserService())->getResetAt($user);
    $resetDate = Carbon\Carbon::createFromTimestamp($resetAt, 'Asia/Shanghai')->format('m-d H:i').' UTC+08:00 · Asia/Shanghai';
    foreach (require resource_path('client/copy.php') as $language=>$copy) {
        app()->setLocale($language);
        $lines = SubscriptionInfo::lines($user);
        $assert($lines === [$copy['next_reset'].': '.$resetDate,$copy['independent'].': '.App\Utils\Helper::trafficConvert(20*1073741824),$copy['reset_count'].': '.sprintf($copy['reset_quantity'],2)], 'Wrong effective credits or locale '.$language);
    }
    foreach (['UTC'=>'UTC+00:00', 'Asia/Kathmandu'=>'UTC+05:45', 'America/Panama'=>'UTC-05:00'] as $zone=>$suffix) {
        config(['app.timezone'=>$zone, 'v2board.system_timezone'=>$zone]);
        date_default_timezone_set($zone);
        DB::table('v2_daily_user_reset')->updateOrInsert(['user_id'=>$user->id,'business_date'=>date('Y-m-d')]);
        $assert(str_ends_with(SubscriptionInfo::lines($user)[0], ' 00:00 '.$suffix.' · '.$zone), 'Incorrect reset time or UTC offset '.$zone);
    }
    config(['app.timezone'=>'Asia/Shanghai', 'v2board.system_timezone'=>'Asia/Shanghai']);
    date_default_timezone_set('Asia/Shanghai');
    app()->setLocale('en-US');
    $copy = (require resource_path('client/copy.php'))['en-US'];
    $user->display_timezone = 'UTC';
    $lines = SubscriptionInfo::lines($user);
    $assert($lines[0] === $copy['next_reset'].': '.Carbon\Carbon::createFromTimestamp($resetAt, 'UTC')->format('m-d H:i').' UTC+00:00 · UTC', 'Saved display preference must preserve the reset instant');
    $assert($lines[1] === $copy['reset_business_timezone'].': Asia/Shanghai (UTC+08:00)', 'Different display preference must name the rule timezone');
    $assert((new App\Services\UserService())->getResetAt($user) === $resetAt, 'Display preference must not change the reset schedule');
    $user->display_timezone = 'Invalid/Timezone';
    $assert(count(SubscriptionInfo::lines($user)) === 3 && str_ends_with(SubscriptionInfo::lines($user)[0], ' UTC+08:00 · Asia/Shanghai'), 'Invalid display preference must fall back to the explicit business timezone');
    $user->display_timezone = null;
    $controller = new App\Services\Actions\Client\ClientActions();
    $method = new ReflectionMethod($controller,'setSubscribeInfoToServers'); $method->setAccessible(true);
    $servers = [['name'=>'Real node','type'=>'vmess']];
    $method->invokeArgs($controller,[&$servers,$user]);
    $assert(count($servers)===4 && end($servers)['name']==='Real node','Supplementary nodes must preserve real nodes');
    $user->credit_balance = 0;
    DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->update(['remaining'=>0]);
    $assert(count(SubscriptionInfo::lines($user))===1, 'Automatic reset must show without manual reset credits');
    // An anniversary reset due today is unconfirmed until its user ledger or global run is complete.
    $plan->reset_traffic_method = 1;
    $plan->save();
    $expiry = $user->expired_at;
    $user->expired_at = Carbon\Carbon::now('Asia/Shanghai')->addYearsNoOverflow(4)->setTime(12, 0)->getTimestamp();
    DB::table('v2_daily_user_reset')->where('user_id', $user->id)->delete();
    DB::table('v2_daily_task_run')->where('task', 'reset:traffic')->where('business_date', date('Y-m-d'))->delete();
    $lines = SubscriptionInfo::lines($user);
    $assert(str_starts_with($lines[0], $copy['reset_pending'].': ') && !str_starts_with($lines[0], $copy['next_reset'].': '), 'Unconfirmed reset must not claim the next cycle');
    DB::table('v2_daily_task_run')->insert(['task'=>'reset:traffic','business_date'=>date('Y-m-d'),'timezone'=>'Asia/Shanghai','status'=>'failed','updated_at'=>time()]);
    $assert(str_starts_with(SubscriptionInfo::lines($user)[0], $copy['reset_failed'].': '), 'Failed reset must show that confirmation is awaiting retry');
    DB::table('v2_daily_user_reset')->insert(['user_id'=>$user->id,'business_date'=>date('Y-m-d')]);
    $assert(str_starts_with(SubscriptionInfo::lines($user)[0], $copy['next_reset'].': '), 'A successful user reset must show the next cycle despite a global failure');
    $user->expired_at = $expiry;
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
    config(['app.timezone'=>$timezone, 'v2board.system_timezone'=>$businessTimezone]);
    date_default_timezone_set($phpTimezone);
}
