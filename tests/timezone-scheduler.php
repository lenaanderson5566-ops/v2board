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
    public function call($command,array $arguments=[]) { self::$calls++; return self::$result; }
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

Illuminate\Support\Facades\Schema::create('v2_stat_user',function ($t) {
    $t->increments('id'); $t->integer('user_id'); $t->integer('record_at'); $t->string('record_timezone')->nullable(); $t->integer('u'); $t->integer('d'); $t->integer('server_rate');
});
config(['v2board.system_timezone'=>'America/New_York']);
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
