<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires disposable database');
use Illuminate\Support\Facades\{DB,Schema};
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage().PHP_EOL);exit(1);});
if(DB::select('SHOW TABLES'))throw new RuntimeException('Requires empty database');
DB::unprepared(file_get_contents(__DIR__.'/../database/install.sql'));
// Reproduce the pre-upgrade schema only inside this verified empty disposable database.
foreach(['v2_user'=>['currency'],'v2_plan'=>['usd_prices'],'v2_payment'=>['currency'],'v2_order'=>['fx_snapshot'],'v2_coupon'=>['public_claim'],'v2_commission_log'=>['currency','order_currency']] as $table=>$columns) Schema::table($table,fn($t)=>$t->dropColumn($columns));
Schema::drop('v2_coupon_wallet');Schema::drop('v2_exchange_rate');
DB::table('v2_user')->insert(['email'=>'legacy-upgrade@example.test','password'=>'fixture','token'=>'fixture','uuid'=>'fixture','balance'=>123456,'commission_balance'=>654321,'created_at'=>time(),'updated_at'=>time()]);
$id=DB::table('v2_user')->value('id');
DB::table('v2_plan')->insert(['name'=>'Legacy price','month_price'=>32800,'year_price'=>299900,'group_id'=>1,'transfer_enable'=>100,'created_at'=>time(),'updated_at'=>time()]);
DB::table('v2_order')->insert(['user_id'=>$id,'plan_id'=>1,'type'=>2,'period'=>'month_price','trade_no'=>'legacy-pending-fixture','total_amount'=>32800,'balance_amount'=>500,'handling_amount'=>25,'status'=>0,'currency'=>'CNY','created_at'=>time(),'updated_at'=>time()]);
$before=[];foreach(['v2_user','v2_plan','v2_order'] as $table)$before[$table]=(array)DB::table($table)->first();
config(['v2board.new_user_currency'=>'USD']);
foreach([1,2] as $pass) foreach(['2026_10_14_000007_add_coupon_wallet.php','2026_10_14_000008_add_billing_currencies.php'] as $file)(require __DIR__.'/../database/migrations/'.$file)->up();
$checks=0;
foreach($before as $table=>$original){$after=(array)DB::table($table)->first();foreach($original as $key=>$value){if($after[$key]!==$value)throw new RuntimeException("Migration changed legacy $table.$key");$checks++;}}
if(DB::table('v2_user')->value('currency')!=='CNY')throw new RuntimeException('Migration relabelled legacy user');
if(DB::table('v2_order')->value('currency')!=='CNY')throw new RuntimeException('Migration relabelled pending order');
echo 'Commerce upgrade: '.($checks+2)." legacy-field checks passed; migrations applied twice.\n";
