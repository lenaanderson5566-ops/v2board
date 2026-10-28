<?php
$app = require __DIR__.'/support/bootstrap.php';
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Carbon\CarbonImmutable as C;
use App\Services\DashboardRevenue;
if (getenv('DASHBOARD_FINANCIAL_PERF')==='1') {
    if(!app()->environment('local') || DB::getDriverName()!=='mysql' || !str_starts_with(DB::connection()->getDatabaseName(),'v2board_test_'))throw new RuntimeException('Financial load fixture requires an isolated MySQL database');
    Schema::create('v2_order',function(Blueprint $t){$t->increments('id');$t->string('currency',3);$t->integer('paid_at');$t->integer('status');$t->integer('total_amount');$t->string('period',24);$t->integer('commission_status');$t->integer('commission_balance');$t->integer('invite_user_id')->nullable();});
    Schema::create('v2_commission_log',function(Blueprint $t){$t->increments('id');$t->string('currency',3);$t->integer('created_at');$t->integer('get_amount');});
    $now=C::now();
    for($chunk=0;$chunk<200;$chunk++){$rows=[];for($i=$chunk*500;$i<($chunk+1)*500;$i++)$rows[]=['currency'=>$i%2?'USD':'CNY','paid_at'=>$now->subDays($i%730)->timestamp,'status'=>3,'total_amount'=>1000,'period'=>$i%5?'month_price':'deposit','commission_status'=>$i%100?3:0,'commission_balance'=>$i%100?0:100,'invite_user_id'=>1];DB::table('v2_order')->insert($rows);}
    for($chunk=0;$chunk<20;$chunk++){$rows=[];for($i=$chunk*500;$i<($chunk+1)*500;$i++)$rows[]=['currency'=>$i%2?'USD':'CNY','created_at'=>$now->subDays($i%730)->timestamp,'get_amount'=>100];DB::table('v2_commission_log')->insert($rows);}
    $start=microtime(true);$before=DashboardRevenue::financial($now);$metrics=['orders'=>100000,'commissionRows'=>10000,'beforeIndexMs'=>round((microtime(true)-$start)*1000,2)];
    $migration=require __DIR__.'/../database/migrations/2026_10_21_000003_index_dashboard_financial.php';$migration->up();$migration->up();
    DB::enableQueryLog();DB::flushQueryLog();$start=microtime(true);$after=DashboardRevenue::financial($now);$metrics['afterIndexMs']=round((microtime(true)-$start)*1000,2);$queries=DB::getQueryLog();DB::disableQueryLog();
    if($before!==$after)throw new RuntimeException('Index changed financial results');
    foreach($queries as $q)$metrics['plans'][]=DB::select('EXPLAIN '.$q['query'],$q['bindings']);
    config(['cache.default'=>'array']);$start=microtime(true);DashboardRevenue::cachedOverview(fn()=>['legacy'=>DashboardRevenue::summary($now),'financial'=>DashboardRevenue::financial($now)]);$metrics['coldCombinedMs']=round((microtime(true)-$start)*1000,2);
    DB::enableQueryLog();DB::flushQueryLog();$start=microtime(true);DashboardRevenue::cachedOverview(function(){throw new RuntimeException('Cache hit rebuilt financial report');});$metrics['warmCombinedMs']=round((microtime(true)-$start)*1000,2);if(count(DB::getQueryLog()))throw new RuntimeException('Warm overview ran SQL');
    $metrics['peakMiB']=round(memory_get_peak_usage(true)/1048576,2);echo json_encode($metrics,JSON_PRETTY_PRINT)."\n";exit(0);
}
config(['database.default' => 'dashboard_test', 'database.connections.dashboard_test' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]);
Schema::create('v2_order', function (Blueprint $table) {
    $table->string('currency',3)->default('CNY');
    $table->increments('id'); $table->integer('paid_at')->nullable();
    $table->integer('created_at'); $table->integer('status'); $table->integer('total_amount');
});
$add = function ($at, $amount, $status = 3) {
    DB::table('v2_order')->insert(['paid_at' => $at ? C::parse($at)->timestamp : null, 'created_at' => 1, 'status' => $status, 'total_amount' => $amount]);
};
$assert = function ($actual, $expected) { if ($actual !== $expected) throw new RuntimeException(json_encode([$actual, $expected])); };
$assert(DashboardRevenue::summary(C::parse('2026-10-12 12:00:00'))['year_income'], 0);
$add('2024-12-31 23:59:59', 999);
$add('2025-01-01 00:00:00', 100);
$add('2025-10-12 12:00:00', 200);
$add('2025-10-12 12:00:01', 400);
$add('2025-12-31 23:59:59', 800);
$add('2026-01-01 00:00:00', 1600);
$add('2026-09-30 23:59:59', 3200);
$add('2026-10-01 00:00:00', 6400);
$add('2026-10-12 12:00:00', 12800);
$add('2026-10-12 12:00:01', 999);
$add('2026-10-01', 999, 0); $add('2026-10-01', 999, 2); $add(null, 999);
DB::enableQueryLog(); DB::flushQueryLog();
$result = DashboardRevenue::summary(C::parse('2026-10-12 12:00:00'));
$assert(count(DB::getQueryLog()), 1);
foreach (['year_income' => 24000, 'last_year_income' => 1500, 'last_year_same_period_income' => 300, 'day_income' => 12800, 'month_income' => 19200, 'last_month_income' => 3200] as $key => $expected) $assert($result[$key], $expected);
DB::table('v2_order')->delete();
$add('2023-02-28 12:00:00', 100); $add('2023-02-28 12:00:01', 200); $add('2023-03-01', 400);
$assert(DashboardRevenue::summary(C::parse('2024-02-29 12:00:00'))['last_year_same_period_income'], 100);
$assert(DashboardRevenue::summary(C::parse('2024-01-01 00:00:00'))['year_income'], 0);
echo "Dashboard revenue: empty, payment basis, statuses, boundaries, leap year and single-query checks passed\n";

// Aggregate all user rate buckets before applying the top-15 limit.
Schema::create('v2_user', function (Blueprint $table) {
    $table->increments('id'); $table->string('email');
});
Schema::create('v2_stat_user', function (Blueprint $table) {
    $table->increments('id'); $table->integer('user_id'); $table->double('server_rate');
    $table->bigInteger('u'); $table->bigInteger('d'); $table->integer('record_at'); $table->string('record_type');
});
$today = strtotime(date('Y-m-d'));
$yesterday = strtotime('-1 day', $today);
for ($id = 1; $id <= 32; $id++) {
    DB::table('v2_user')->insert(['id'=>$id, 'email'=>'rank'.$id.'@example.test']);
    foreach ([$today, $yesterday] as $day) {
        DB::table('v2_stat_user')->insert(['user_id'=>$id, 'server_rate'=>1, 'u'=>100, 'd'=>0, 'record_at'=>$day, 'record_type'=>'d']);
    }
}
foreach ([$today, $yesterday] as $day) {
    DB::table('v2_stat_user')->insert(['user_id'=>32,'server_rate'=>100,'u'=>1,'d'=>99,'record_at'=>$day,'record_type'=>'d']);
    DB::table('v2_stat_user')->insert(['user_id'=>31,'server_rate'=>2,'u'=>50,'d'=>49,'record_at'=>$day,'record_type'=>'d']);
}
$controller = new App\Http\Controllers\V1\Admin\StatController();
foreach (['getUserTodayRank', 'getUserLastRank'] as $method) {
    DB::flushQueryLog();
    $rank = $controller->$method()['data'];
    $assert(count($rank), 15);
    $assert($rank[0]['user_id'], 32);
    $assert($rank[0]['u'], 101);
    $assert($rank[0]['d'], 99);
    $assert($rank[0]['total'], 10100 / 1073741824);
    $assert($rank[1]['user_id'], 31);
    $assert($rank[2]['user_id'], 1);
    $assert(count(DB::getQueryLog()), 2);
}
echo "Dashboard user ranks: aggregation, rate weighting, ties, dates and batched emails passed\n";

Schema::create('v2_server_v2box', function (Blueprint $table) {
    $table->increments('id'); $table->string('name'); $table->integer('service_id')->nullable();
});
Schema::create('v2_stat_server', function (Blueprint $table) {
    $table->increments('id'); $table->integer('server_id'); $table->string('server_type');
    $table->bigInteger('u'); $table->bigInteger('d'); $table->integer('record_at'); $table->string('record_type');
});
for ($id = 1; $id <= 32; $id++) {
    DB::table('v2_server_v2box')->insert(['id'=>$id,'name'=>'Node '.$id]);
    foreach ([$today, $yesterday] as $day) {
        DB::table('v2_stat_server')->insert(['server_id'=>$id,'server_type'=>'v2box','u'=>100,'d'=>0,'record_at'=>$day,'record_type'=>'d']);
    }
}
foreach ([$today, $yesterday] as $day) {
    DB::table('v2_stat_server')->insert(['server_id'=>32,'server_type'=>'v2box','u'=>50,'d'=>150,'record_at'=>$day,'record_type'=>'d']);
    DB::table('v2_stat_server')->insert(['server_id'=>33,'server_type'=>'v2box','u'=>200,'d'=>0,'record_at'=>$day,'record_type'=>'d']);
    DB::table('v2_stat_server')->insert(['server_id'=>1,'server_type'=>'v2box','u'=>9999,'d'=>0,'record_at'=>$day,'record_type'=>'h']);
}
foreach (['getServerTodayRank', 'getServerLastRank'] as $method) {
    DB::flushQueryLog();
    $rank = $controller->$method()['data'];
    $assert(count($rank), 15);
    $assert($rank[0]['server_id'], 32);
    $assert($rank[0]['u'], 150);
    $assert($rank[0]['d'], 150);
    $assert($rank[0]['total'], 300 / 1073741824);
    $assert($rank[0]['server_name'], 'Node 32');
    $assert($rank[1]['server_id'], 33);
    $assert($rank[1]['server_name'], null);
    $assert($rank[2]['server_id'], 1);
    $queries = DB::getQueryLog();
    $assert(count($queries), 2);
    $assert(count($queries[1]['bindings']), 15);
}
echo "Dashboard server ranks: aggregate before limit, stable ties, missing names and bounded name lookup passed\n";

Schema::table('v2_order',function(Blueprint $t){$t->string('period')->default('month_price');$t->integer('commission_status')->default(0);$t->integer('commission_balance')->default(0);$t->integer('invite_user_id')->nullable();});
Schema::create('v2_commission_log',function(Blueprint $t){$t->increments('id');$t->string('currency');$t->integer('created_at');$t->integer('get_amount');});
DB::table('v2_order')->delete();
$add('2026-10-12 11:00:00',1000);$add('2026-10-12 11:00:00',0);
$add('2026-09-12 11:00:00',500);$add('2026-09-13 11:00:00',999);
$add('2026-10-12 11:00:00',999,0);$add('2026-10-12 11:00:00',999,2);
DB::table('v2_order')->insert(['currency'=>'USD','period'=>'deposit','paid_at'=>C::parse('2026-10-12 11:00:00')->timestamp,'created_at'=>1,'status'=>3,'total_amount'=>700]);
DB::table('v2_commission_log')->insert(['currency'=>'USD','created_at'=>C::parse('2026-10-12')->timestamp,'get_amount'=>50]);
DB::flushQueryLog();$finance=DashboardRevenue::financial(C::parse('2026-10-12 12:00:00'));
$assert(count(DB::getQueryLog()),4);
$cny=$finance['currencies'][0];$usd=$finance['currencies'][1];
$assert($cny['month_amount'],1000);$assert($cny['month_count'],2);$assert($cny['average_amount'],500);
$assert($cny['comparable_amount'],500);$assert($cny['change_percent'],100.0);$assert($cny['deposit_amount'],0);
$assert($usd['month_amount'],700);$assert($usd['deposit_amount'],700);$assert($usd['subscription_amount'],0);$assert($usd['commission_paid'],50);
$assert($usd['change_percent'],null);$assert($usd['daily'][29]['count'],1);$assert(count($usd['daily']),30);$assert($usd['daily'][0]['count'],0);
echo "Financial dashboard: currency isolation, deposits, zero payments, same-period comparison, daily counts and four-query bound passed\n";

config(['cache.default'=>'array']);
DB::flushQueryLog();
$cached=DashboardRevenue::cachedOverview(fn()=>DashboardRevenue::financial(C::parse('2026-10-12 12:00:00')));
$assert(count(DB::getQueryLog()),4);DB::flushQueryLog();
$again=DashboardRevenue::cachedOverview(function(){throw new RuntimeException('Cache hit must not rebuild');});
$assert($again,$cached);$assert(count(DB::getQueryLog()),0);
echo "Dashboard overview cache: warm requests execute no financial SQL\n";

$indexes=require __DIR__.'/../database/migrations/2026_10_21_000003_index_dashboard_financial.php';$indexes->up();$indexes->up();
$assert(Schema::hasIndex('v2_order','order_paid_currency'),true);
$assert(Schema::hasIndex('v2_order','order_pending_commission'),true);
$assert(Schema::hasIndex('v2_commission_log','commission_created_currency'),true);
echo "Financial index migration is idempotent\n";
