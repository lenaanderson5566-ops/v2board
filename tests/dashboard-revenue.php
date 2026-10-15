<?php
$app = require __DIR__.'/support/bootstrap.php';
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Carbon\CarbonImmutable as C;
use App\Services\DashboardRevenue;
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
