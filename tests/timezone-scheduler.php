<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
// Every query below uses a private, empty in-memory connection.
config(['database.connections.timezone_test'=>['driver'=>'sqlite','database'=>':memory:','prefix'=>'']]);
Illuminate\Support\Facades\DB::setDefaultConnection('timezone_test');
config(['cache.default'=>'array']);
Illuminate\Support\Facades\Cache::swap(new Illuminate\Cache\CacheManager($app));
Illuminate\Support\Facades\Schema::create('v2_daily_task_run',function ($t) {
    $t->string('task'); $t->date('business_date'); $t->string('timezone'); $t->string('status'); $t->integer('updated_at'); $t->primary(['task','business_date']);
});
class FakeDailyTask extends App\Console\Commands\RunDailyTask {
    public static $calls=0;
    public static $result=0;
    public static $commands=[];
    public function call($command,array $arguments=[]) { self::$calls++; self::$commands[]=$command; return self::$result; }
}
$command=new FakeDailyTask;
$command->setLaravel($app);
$run=function () use ($command) { return $command->run(new Symfony\Component\Console\Input\ArrayInput(['task'=>'reset:traffic']),new Symfony\Component\Console\Output\BufferedOutput); };
$check=function ($ok,$message) { if (!$ok) throw new RuntimeException($message); };
$run(); $run();
$check(FakeDailyTask::$calls===1,'Completed day ran twice');
$row=Illuminate\Support\Facades\DB::table('v2_daily_task_run');
$row->delete(); FakeDailyTask::$result=1;
$check($run()===1,'Failure was not propagated');
$run(); $check(FakeDailyTask::$calls===2,'Failed task retried without backoff');
$row->update(['updated_at'=>time()-301]); FakeDailyTask::$result=0;
$run(); $check(FakeDailyTask::$calls===3,'Failed task did not retry');
$check($row->value('status')==='completed','Retry completion missing');
echo "Daily scheduler: 5 isolated integration checks passed\n";

// Renaming the command must not repeat an already completed business date or bypass its lock.
$identityZone=gmdate('H:i') >= '00:10' ? 'UTC' : 'Asia/Shanghai';
$identityConfigDirectory=sys_get_temp_dir().'/statistics-config-'.bin2hex(random_bytes(8));
mkdir($identityConfigDirectory,0700);
file_put_contents($identityConfigDirectory.'/fastai.php','<?php return '.var_export(['system_timezone'=>$identityZone],true).';');
$originalConfigDirectory=$app->configPath();
$app->useConfigPath($identityConfigDirectory);
try {
    $identityDate=(new DateTimeImmutable('now',new DateTimeZone($identityZone)))->format('Y-m-d');
    $statisticsRun=function (string $task) use ($command) { return $command->run(new Symfony\Component\Console\Input\ArrayInput(['task'=>$task]),new Symfony\Component\Console\Output\BufferedOutput); };
    $row->delete();
    $beforeStatistics=FakeDailyTask::$calls;
    $row->insert(['task'=>'v2board:statistics','business_date'=>$identityDate,'timezone'=>$identityZone,'status'=>'completed','updated_at'=>time()]);
    $check($statisticsRun('fastai:statistics')===0 && $statisticsRun('v2board:statistics')===0
        && FakeDailyTask::$calls===$beforeStatistics && $row->count()===1, 'Canonical statistics must honor a completed legacy daily identity');
    $statusCommand=new App\Console\Commands\DailyTaskStatus;
    $statusCommand->setLaravel($app);
    $statusTester=new Symfony\Component\Console\Tester\CommandTester($statusCommand);
    $statusCode=$statusTester->execute([]);
    $statusOutput=$statusTester->getDisplay();
    $statisticsLine=collect(explode("\n",$statusOutput))->first(fn($line)=>str_contains($line,'fastai:statistics'));
    $check($statusCode===0 && $statisticsLine && str_contains($statisticsLine,'completed') && !str_contains($statusOutput,'v2board:statistics'),
        'Daily status must show canonical statistics with its completed legacy record');
    $row->delete();
    $legacyLock=Illuminate\Support\Facades\Cache::lock('system:daily:v2board:statistics',3600);
    $check($legacyLock->get(), 'Could not acquire the legacy statistics fixture lock');
    try {
        $check($statisticsRun('fastai:statistics')===0 && FakeDailyTask::$calls===$beforeStatistics && $row->count()===0,
            'Canonical statistics must not bypass a running legacy task lock');
    } finally { $legacyLock->release(); }
    $check($statisticsRun('fastai:statistics')===0 && FakeDailyTask::$calls===$beforeStatistics+1
        && end(FakeDailyTask::$commands)==='fastai:statistics', 'Daily statistics must execute the canonical command once');
    $check(Illuminate\Support\Facades\DB::table('v2_daily_task_run')->where('task','v2board:statistics')->value('status')==='completed'
        && Illuminate\Support\Facades\DB::table('v2_daily_task_run')->where('task','fastai:statistics')->count()===0,
        'Daily statistics must retain its existing persistent identity');
    $check($statisticsRun('v2board:statistics')===0 && FakeDailyTask::$calls===$beforeStatistics+1,
        'A legacy invocation must not repeat the canonical run');
    echo "Statistics command identity compatibility passed\n";
} finally {
    $app->useConfigPath($originalConfigDirectory);
    unlink($identityConfigDirectory.'/fastai.php');
    rmdir($identityConfigDirectory);
}

Illuminate\Support\Facades\Schema::create('v2_stat_user',function ($t) {
    $t->increments('id'); $t->integer('user_id'); $t->integer('record_at'); $t->string('record_timezone')->nullable(); $t->integer('u'); $t->integer('d'); $t->integer('server_rate');
});
config(['fastai.system_timezone'=>'America/New_York']);
date_default_timezone_set('America/New_York');
$day=date('Y-m-d');
foreach ([null,'America/New_York'] as $zone) {
    $at=(new DateTimeImmutable($day.' 00:00:00',new DateTimeZone($zone??'Asia/Shanghai')))->getTimestamp();
    Illuminate\Support\Facades\DB::table('v2_stat_user')->insert(['user_id'=>1,'record_at'=>$at,'record_timezone'=>$zone,'u'=>1,'d'=>2,'server_rate'=>1]);
}
$request=Illuminate\Http\Request::create('/','GET',['days'=>7,'user'=>['id'=>1]]);
$data=json_decode((new App\Services\Actions\User\StatActions)->getTrafficLog($request)->getContent(),true)['data'];
$check(count($data)===2,'Mixed-zone records missing');
$check(count(array_filter($data,fn($row)=>$row['business_date']===$day))===2,'Historical business dates shifted');
$check(in_array('Asia/Shanghai',array_column($data,'record_timezone'),true),'Legacy zone missing');
echo "Historical business dates: 3 isolated checks passed\n";

// The status read shares the execution rules and never performs a reset.
Illuminate\Support\Facades\Schema::create('v2_plan', function ($t) {
    $t->increments('id'); $t->integer('reset_traffic_method')->nullable();
});
Illuminate\Support\Facades\Schema::create('v2_daily_user_reset', function ($t) {
    $t->integer('user_id'); $t->date('business_date'); $t->unique(['user_id','business_date']);
});
Illuminate\Support\Facades\DB::table('v2_plan')->insert(['id'=>1,'reset_traffic_method'=>0]);
Illuminate\Support\Facades\DB::table('v2_daily_task_run')->delete();
config(['fastai.system_timezone'=>'Asia/Shanghai']);
date_default_timezone_set('UTC');
$zone = new DateTimeZone('Asia/Shanghai');
$at = fn ($value) => (new DateTimeImmutable($value, $zone))->getTimestamp();
$now = $at('2026-11-01 00:00:30');
$user = new App\Models\User;
$user->id=101; $user->plan_id=1; $user->transfer_enable=1000; $user->expired_at=$at('2027-04-01 00:00:00'); $user->u=100; $user->d=200;
$service = new App\Services\UserService;
$status = $service->getResetInfo($user, $at('2026-10-31 23:59:00'));
$check($status===['at'=>$at('2026-11-01 00:00:00'),'state'=>'scheduled','timezone'=>'Asia/Shanghai'],'Upcoming reset did not respect business timezone');
$status = $service->getResetInfo($user, $now);
$check($status['at']===$at('2026-11-01 00:00:00') && $status['state']==='pending','Missing daily run jumped ahead to next month');
$task=['task'=>'reset:traffic','business_date'=>'2026-11-01','timezone'=>'Asia/Shanghai','status'=>'running','updated_at'=>$now];
Illuminate\Support\Facades\DB::table('v2_daily_task_run')->insert($task);
$check($service->getResetInfo($user,$now)['state']==='pending','Running daily task reported a future reset');
Illuminate\Support\Facades\DB::table('v2_daily_task_run')->update(['status'=>'failed']);
$check($service->getResetInfo($user,$now)['state']==='failed','Failed daily run lost retry status');
Illuminate\Support\Facades\DB::table('v2_daily_user_reset')->insert(['user_id'=>101,'business_date'=>'2026-11-01']);
$done=$service->getResetInfo($user,$now);
$check($done['state']==='scheduled' && $done['at']===$at('2026-12-01 00:00:00'),'Completed user reset was hidden by another user failure');
$other=clone $user; $other->id=202;
$check($service->getResetInfo($other,$now)['state']==='failed','One user reset receipt affected another user');
foreach (['completed','skipped_upgrade'] as $state) {
    Illuminate\Support\Facades\DB::table('v2_daily_task_run')->update(['status'=>$state]);
    $check($service->getResetInfo($other,$now)['state']==='scheduled','Completed or upgrade-skipped daily task shown as pending');
}
Illuminate\Support\Facades\DB::table('v2_daily_task_run')->delete();
$other->expired_at=$at('2026-11-01 12:00:00');
$check($service->getResetInfo($other,$now)['state']==='pending','Due reset vanished because no later reset fits before expiry');
Illuminate\Support\Facades\DB::enableQueryLog(); Illuminate\Support\Facades\DB::flushQueryLog();
$service->getResetInfo($other,$now);
$writes=array_filter(Illuminate\Support\Facades\DB::getQueryLog(),fn($row)=>preg_match('/^\s*(insert|update|delete|replace)/i',$row['query']));
Illuminate\Support\Facades\DB::disableQueryLog();
$check(!$writes && $other->u===100 && $other->d===200,'Reset-status read mutated quota or task records');
$other->expired_at=$now;
$check($service->getResetInfo($other,$now)['at']===null,'Expired account advertised a due reset');
$other->expired_at=$user->expired_at; $other->transfer_enable=0;
$check($service->getResetInfo($other,$now)['state']===null,'Credit-only account advertised an automatic reset');
$other->transfer_enable=1000; $other->plan_id=null;
$check($service->getResetInfo($other,$now)['state']===null,'Account without a plan advertised a reset');
$check(date_default_timezone_get()==='UTC','Status read changed process/display timezone');
echo "Reset status: 14 isolated checks passed\n";

// A manual reset replaces the old calendar day with a business-local anchor.
$anchor = $at('2026-11-10 17:00:00');
$user->traffic_reset_anchor_at = $anchor;
$firstReset = $at('2026-12-10 00:00:00');
$check($service->getResetInfo($user, $anchor)['at'] === $firstReset, 'Manual reset did not start a new monthly cycle');
$check($service->getResetInfo($user, $at('2026-12-01 00:00:00'))['at'] === $firstReset, 'Old calendar boundary remained due after manual reset');
$status = $service->getResetInfo($user, $firstReset);
$check($status['at'] === $firstReset && $status['state'] === 'pending', 'Anchored reset day did not report the pending run');
Illuminate\Support\Facades\DB::table('v2_daily_user_reset')->insert(['user_id'=>101, 'business_date'=>'2026-12-10']);
$status = $service->getResetInfo($user, $firstReset);
$check($status['at'] === $at('2027-01-10 00:00:00') && $status['state'] === 'scheduled', 'Reset receipt did not advance to the next anchored cycle');
$user->expired_at = $at('2026-12-20 00:00:00');
Illuminate\Support\Facades\DB::table('v2_plan')->where('id', 1)->update(['reset_traffic_method'=>1]);
$check($service->getResetInfo($user, $anchor)['at'] === $firstReset, 'Legacy expiry guard suppressed a paid anchored cycle before actual expiry');
$user->expired_at = $firstReset;
$check($service->getResetInfo($user, $anchor)['at'] === null, 'Anchored reset at expiry was advertised');
$user->expired_at = $at('2027-04-01');
Illuminate\Support\Facades\DB::table('v2_plan')->where('id', 1)->update(['reset_traffic_method'=>2]);
$check($service->getResetInfo($user, $anchor)['at'] === null, 'No-reset plan acquired an automatic cycle from the anchor');
echo "Anchored reset status: 7 isolated checks passed\n";
