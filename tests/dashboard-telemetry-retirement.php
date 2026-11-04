<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local') || getenv('TEST_DISPOSABLE_WORKSPACE') !== '1'
    || !preg_match('/\Acommerce_test_[a-f0-9]{8}\z/', DB::connection()->getDatabaseName())) {
    throw new RuntimeException('Run dashboard telemetry retirement in an isolated test database.');
}

$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$migration = require database_path('migrations/2026_11_04_000004_retire_dashboard_telemetry.php');
$migration->up();
$assert(!Schema::hasTable('v2_analytics_session'), 'Cleanup is safe before analytics tables exist');

foreach ([
    '2026_10_17_000001_create_product_analytics.php',
    '2026_10_17_000002_add_analytics_sources.php',
    '2026_10_19_000001_create_analytics_measurements.php',
    '2026_10_19_000003_add_analytics_browsers.php',
] as $filename) {
    $historical = require database_path('migrations/'.$filename);
    $historical->up();
}

$session = ['session_hash'=>str_repeat('a', 64), 'device'=>'mobile', 'created_at'=>100, 'last_at'=>110,
    'stage'=>3, 'attribution_version'=>1, 'source_domain'=>'example.test'];
$session['id'] = DB::table('v2_analytics_session')->insertGetId($session + [
    'browser'=>'chrome', 'browser_major'=>137, 'embedded'=>'wechat', 'language'=>'zh-CN', 'os'=>'android',
]);
DB::table('v2_analytics_page')->insert(['session_id'=>$session['id'], 'page'=>'plan', 'views'=>20, 'created_at'=>100]);
$measurement = ['session_id'=>$session['id'], 'page'=>'payment', 'bucket'=>0, 'samples'=>2, 'value_sum'=>120];
$kept = ['copy_failed', 'api_error', 'network_error', 'js_error', 'api_request', 'lcp', 'inp', 'cls'];
$retired = ['download', 'copy_success', 'import_start', 'help_open', 'guide_manual', 'guide_continue', 'payment_open'];
DB::table('v2_analytics_measurement')->insert(array_map(fn ($event) => $measurement + ['event'=>$event], [...$kept, ...$retired]));
DB::table('v2_analytics_measurement')->insert(array_map(fn ($bucket) => array_replace($measurement, [
    'event'=>'guide_manual', 'bucket'=>$bucket,
]), range(1, 1001)));

Schema::table('v2_analytics_session', fn (Blueprint $table) => $table->dropColumn('browser_major'));
$migration->up();
$migration->up();
$assert(!Schema::hasTable('v2_analytics_page'), 'Historical page views table is removed on repeated upgrade');
foreach (['browser', 'browser_major', 'embedded', 'language', 'os'] as $column) {
    $assert(!Schema::hasColumn('v2_analytics_session', $column), 'Unused session column removed: '.$column);
}
$saved = (array)DB::table('v2_analytics_session')->find($session['id']);
$assert(count($session) === count($saved) && $session == $saved, 'Session, attribution, device and funnel fields remain unchanged');
$saved = DB::table('v2_analytics_measurement')->orderBy('event')->get();
sort($kept);
$assert($saved->pluck('event')->all() === $kept && $saved->every(fn ($row) => (int)$row->samples === 2 && (int)$row->value_sum === 120),
    'Only obsolete measurement events are removed across batches');
try {
    $migration->down();
    throw new LogicException('Migration rollback pretended to restore removed data');
} catch (RuntimeException $error) {
    $assert(str_contains($error->getMessage(), 'restore a database backup'), 'Irrecoverable history rollback requires a database backup');
}

echo "PASS: {$checks} dashboard telemetry retirement checks\n";
