<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
config(['database.default'=>'legacy_credit_test','database.connections.legacy_credit_test'=>['driver'=>'sqlite','database'=>':memory:','prefix'=>'']]);
Schema::create('v2_user',function(Blueprint $t) {
    $t->increments('id'); $t->integer('expired_at')->nullable(); $t->integer('plan_id')->nullable();
    foreach(['transfer_enable','u','d','group_id','speed_limit','device_limit','created_at','updated_at'] as $key) $t->bigInteger($key)->default(0);
    $t->string('token')->default('legacy-token'); $t->string('uuid')->default('legacy-uuid');
});
Schema::create('v2_order',function(Blueprint $t) {
    $t->increments('id'); $t->integer('user_id'); $t->integer('status'); $t->string('period');
});
DB::table('v2_user')->insert([
    ['id'=>1,'plan_id'=>1,'expired_at'=>null,'transfer_enable'=>1000,'u'=>200,'d'=>300],
    ['id'=>2,'plan_id'=>1,'expired_at'=>time()+86400,'transfer_enable'=>1000,'u'=>100,'d'=>100],
]);
$assert=function($ok,$why) {if(!$ok) throw new RuntimeException($why);};
$early=require __DIR__.'/../database/migrations/2026_10_02_000005_create_traffic_credits.php';
$early->up(); $early->up();
$user=DB::table('v2_user')->find(1);
$assert($user->credit_balance===500 && $user->transfer_enable===0,'legacy balance preserved once');
$assert($user->token==='legacy-token' && $user->uuid==='legacy-uuid','credentials preserved');
$assert(DB::table('v2_credit_batch')->where('user_id',1)->sum('remaining_bytes')===500,'early migration creates batches before conversion');
$assert(DB::table('v2_traffic_credit_log')->count()===1,'resuming conversion does not duplicate log');
$assert(DB::table('v2_user')->find(2)->transfer_enable===1000,'period subscriptions preserved');
Schema::create('v2_invitation_reward',function(Blueprint $t) {$t->increments('id');});
DB::table('v2_user')->insert(['id'=>3,'credit_balance'=>700]);
DB::table('v2_credit_batch')->insert(['user_id'=>3,'reference'=>'existing:3','remaining_bytes'=>200,'expires_at'=>1,'created_at'=>1]);
$late=require __DIR__.'/../database/migrations/2026_10_05_000002_create_credit_batches.php';
$late->up(); $late->up();
$assert(DB::table('v2_credit_batch')->where('user_id',1)->count()===1,'later backfill does not duplicate legacy grants');
$assert(DB::table('v2_credit_batch')->where('user_id',3)->sum('remaining_bytes')===700,'only uncovered old balance backfilled once');
$assert(DB::table('v2_credit_batch')->where('reference','upgrade:3')->value('remaining_bytes')===500,'expired tracked bytes are not renewed');
echo "Legacy credit migrations: fresh schema, resume, balance and backfill checks passed\n";
