<?php
// Pure time calculations and an isolated SQLite ledger; no application DB or jobs.
require __DIR__.'/../vendor/autoload.php';
use App\Services\TrafficResetSchedule;
use App\Console\Commands\RunDailyTask;
$checks=0;
$check=function ($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
foreach (['Asia/Shanghai','UTC','Asia/Kathmandu','America/New_York','Australia/Adelaide'] as $zone) {
    date_default_timezone_set($zone);
    $now=new DateTimeImmutable('2026-10-31 23:59:00');
    $next=TrafficResetSchedule::next(0,strtotime('2027-12-01'),$now->getTimestamp());
    $check(date('Y-m-d H:i:s',$next)==='2026-11-01 00:00:00',"Wrong local reset in $zone");
    $check(RunDailyTask::due('reset:traffic',new DateTimeImmutable('2026-11-01 00:00:00')), 'Midnight skipped');
    $check(!RunDailyTask::due('v2board:statistics',new DateTimeImmutable('2026-11-01 00:09:59')), 'Statistics early');
    $check(RunDailyTask::due('v2board:statistics',new DateTimeImmutable('2026-11-01 00:12:00')), 'Delayed schedule skipped');
}
date_default_timezone_set('America/New_York');
foreach (['2026-03-08','2026-11-01'] as $day) {
    $begin=new DateTimeImmutable($day.' 00:00:00');
    $end=$begin->modify('+1 day');
    $check(in_array($end->getTimestamp()-$begin->getTimestamp(),[23*3600,25*3600],true),'DST day must not be fixed 86400 seconds');
    $check(RunDailyTask::due('reset:traffic',$begin),'DST midnight missing');
}
date_default_timezone_set('America/Sao_Paulo');
$next=TrafficResetSchedule::next(0,strtotime('2019-02-01'),strtotime('2018-11-03 12:00:00'));
$check(date('Y-m-d H:i:s',$next)==='2018-12-01 00:00:00','Midnight DST transition drifted reset time');
date_default_timezone_set('UTC');
$businessNow = (new DateTimeImmutable('2026-10-31 23:59:00', new DateTimeZone('Asia/Shanghai')))->getTimestamp();
$businessExpiry = (new DateTimeImmutable('2027-12-01', new DateTimeZone('Asia/Shanghai')))->getTimestamp();
$businessNext = TrafficResetSchedule::next(0, $businessExpiry, $businessNow, 'Asia/Shanghai');
$check(gmdate('Y-m-d H:i:s', $businessNext)==='2026-10-31 16:00:00','Explicit business timezone was replaced by display/default UTC');
$check(TrafficResetSchedule::due(0, $businessExpiry, $businessNext, 'Asia/Shanghai'), 'Business midnight not due in explicit timezone');
$check(!TrafficResetSchedule::due(0, $businessExpiry, $businessNext, 'UTC'), 'UTC display must not shift the business reset date');
$check(date_default_timezone_get()==='UTC', 'Explicit reset calculations changed global timezone');
$db=new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE ledger (task TEXT, business_date TEXT, timezone TEXT, PRIMARY KEY(task,business_date))');
$insert=$db->prepare('INSERT OR IGNORE INTO ledger VALUES (?,?,?)');
$insert->execute(['reset:traffic','2026-11-01','America/New_York']);
$check($insert->rowCount()===1,'First date missing');
$insert->execute(['reset:traffic','2026-11-01','Asia/Shanghai']);
$check($insert->rowCount()===0,'Zone change must not duplicate the same business date');
$insert->execute(['reset:traffic','2026-11-02','Asia/Shanghai']);
$check($insert->rowCount()===1,'Next date blocked');
$originalContainer = Illuminate\Container\Container::getInstance();
$container = new Illuminate\Container\Container;
$configuration = new Illuminate\Config\Repository(['v2board'=>['system_timezone'=>'America/New_York']]);
$container->instance('config', $configuration);
Illuminate\Container\Container::setInstance($container);
try {
    foreach (['UTC', 'Asia/Shanghai', 'Asia/Kathmandu'] as $phpZone) {
        date_default_timezone_set($phpZone);
        $check(App\Services\TimeZones::iso8601(strtotime('2026-11-01T05:30:37Z')) === '2026-11-01T01:30:37-04:00', 'Export lost the first DST instant');
        $check(App\Services\TimeZones::iso8601(strtotime('2026-11-01T06:30:37Z')) === '2026-11-01T01:30:37-05:00', 'Export lost the second DST instant');
    }
    $configuration->set('v2board.system_timezone', 'Asia/Kathmandu');
    $check(App\Services\TimeZones::iso8601(strtotime('2026-10-19T00:00:37Z')) === '2026-10-19T05:45:37+05:45', 'Export lost a fractional-hour offset');
    $configuration->set('v2board.system_timezone', 'UTC');
    $check(App\Services\TimeZones::iso8601(0) === '1970-01-01T00:00:00+00:00', 'Epoch is a valid explicit instant');
    $check(App\Services\TimeZones::iso8601(null) === null, 'Missing export time must stay empty');
} finally {
    Illuminate\Container\Container::setInstance($originalContainer);
    date_default_timezone_set('UTC');
}

echo "Time zones: $checks checks passed\n";
