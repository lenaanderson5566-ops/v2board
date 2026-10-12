<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(function(Throwable $error) {fwrite(STDERR,$error->getMessage().PHP_EOL); exit(1);});
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
$original=config('database.default'); $temporary=null;
if (getenv('LEGACY_SCHEMA_MYSQL')==='1') {
    if (!app()->environment('local')) throw new RuntimeException('MySQL migration test is local only');
    $temporary=getenv('LEGACY_SCHEMA_DATABASE') ?: 'legacy_ops_test_'.bin2hex(random_bytes(6));
    if (!preg_match('/^legacy_ops_test_[a-f0-9]{12}$/',$temporary)) throw new RuntimeException('Invalid isolated database name');
    DB::connection($original)->statement('CREATE DATABASE IF NOT EXISTS `'.$temporary.'`');
    $connection=config('database.connections.'.$original); $connection['database']=$temporary;
} else $connection=['driver'=>'sqlite','database'=>':memory:','prefix'=>''];
config(['database.default'=>'legacy_ops_test','database.connections.legacy_ops_test'=>$connection]);
try {
Schema::create('v2_user',function(Blueprint $t) {$t->increments('id'); $t->integer('last_login_ip')->nullable();});
DB::table('v2_user')->insert(['id'=>1,'last_login_ip'=>2130706433]);
Schema::create('v2_plan',function(Blueprint $t) {$t->integer('id')->primary();});
Schema::create('v2_log',function(Blueprint $t) {
    $t->increments('id'); $t->integer('created_at'); $t->string('level');
    $t->string('request_id',36)->nullable()->index('log_request_id_idx');
    $t->unsignedSmallInteger('http_status')->nullable();
});
DB::table('v2_log')->insert(['created_at'=>1,'level'=>'ERROR','request_id'=>'preserved']);
require __DIR__.'/../database/migrations/2026_02_26_000013_create_user_online_snapshot_table.php';
(new CreateUserOnlineSnapshotTable())->up();
DB::table('v2_user_online_snapshot')->insert([
    ['user_id'=>1,'ip'=>'192.0.2.1','node'=>'old','source'=>'alive','online_at'=>1],
    ['user_id'=>1,'ip'=>'192.0.2.2','node'=>'new','source'=>'alive','online_at'=>2],
]);
$assert=function($ok,$why) {if(!$ok) throw new RuntimeException($why);};
$baseline=require __DIR__.'/../database/migrations/2026_10_11_000000_ensure_operations_schema.php';
$baseline->up();
foreach(['v2_login_log','v2_subscribe_log','v2_risk_rule_hit','v2_risk_rule_config','v2_risk_setting','v2_client_strategy','v2_user_connection_log','v2_plan_translation','v2_risk_blacklist_ip','v2_risk_blacklist_ua_hash'] as $table) $assert(Schema::hasTable($table),'missing baseline table: '.$table);
$assert(Schema::hasColumn('v2_subscribe_log','traffic_total') && Schema::hasColumn('v2_client_strategy','min_version'),'missing historical columns');
$assert(DB::table('v2_user_online_snapshot')->count()===1 && DB::table('v2_user_online_snapshot')->value('node')==='new','latest snapshot preserved');
DB::table('v2_risk_rule_config')->update(['enabled'=>0]);
DB::table('v2_login_log')->insert(['email'=>'preserved@example.test','created_at'=>1]);
$baseline->up();
$assert(DB::table('v2_login_log')->count()===1,'existing log preserved');
$assert(DB::table('v2_risk_rule_config')->where('enabled',1)->count()===0,'custom policies preserved');
$assert(DB::table('v2_risk_blacklist_ua_hash')->count()===0,'no historical default UA bans replayed');
require __DIR__.'/../database/migrations/2026_10_11_000006_index_log_metadata.php';
$indexes=new IndexLogMetadata(); $indexes->up(); $indexes->up();
$assert(DB::table('v2_log')->value('request_id')==='preserved','partial metadata migration preserves records');
$assert(Schema::hasColumn('v2_log','duration_ms') && Schema::hasIndex('v2_subscribe_log','v2_subscribe_log_created_id_idx'),'metadata migration completed');
$assert(Schema::hasIndex('v2_user_online_snapshot','v2_user_online_snapshot_user_source_unique'),'online snapshot uniqueness');
echo "Legacy operations migrations: missing tables, existing policies, partial indexes and retries passed\n";

} finally {
    DB::purge('legacy_ops_test');
    if ($temporary) DB::connection($original)->statement('DROP DATABASE `'.$temporary.'`');
}
