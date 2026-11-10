<?php
$app = require __DIR__.'/support/bootstrap.php';
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
config(['fastai.new_user_currency'=>'USD']);
foreach([1,2] as $pass) foreach(['2026_10_14_000007_add_coupon_wallet.php','2026_10_14_000008_add_billing_currencies.php'] as $file)(require __DIR__.'/../database/migrations/'.$file)->up();
$checks=0;
foreach($before as $table=>$original){$after=(array)DB::table($table)->first();foreach($original as $key=>$value){if($after[$key]!==$value)throw new RuntimeException("Migration changed legacy $table.$key");$checks++;}}
if(DB::table('v2_user')->value('currency')!=='CNY')throw new RuntimeException('Migration relabelled legacy user');
if(DB::table('v2_order')->value('currency')!=='CNY')throw new RuntimeException('Migration relabelled pending order');
echo 'Commerce upgrade: '.($checks+2)." legacy-field checks passed; migrations applied twice.\n";

// The install SQL already has the newest diagnostic columns. Recreate each old
// phase so the regression actually executes DDL against existing history.
$attemptTable = 'v2_payment_attempt_event';
$callbackTable = 'v2_payment_callback_event';
Schema::drop($attemptTable);
Schema::table($callbackTable, fn($table) => $table->dropColumn('raw_diagnostic'));
$orderId = DB::table('v2_order')->where('trade_no', 'legacy-pending-fixture')->value('id');
$event = [
    'order_id' => $orderId,
    'provider' => 'EPayQrcode',
    'stage' => 'provider',
    'result' => 'failed',
    'request_id' => '11111111-1111-4111-8111-111111111111',
    'created_at' => time(),
];
$callbackId = DB::table($callbackTable)->insertGetId($event);
$migrationDir = __DIR__.'/../database/migrations/';
$createAttempts = require $migrationDir.'2026_11_09_000001_create_payment_attempt_events.php';
$addSummary = require $migrationDir.'2026_11_09_000002_add_payment_gateway_response_summary.php';
$addRaw = require $migrationDir.'2026_11_09_000003_add_raw_payment_diagnostics.php';
$createAttempts->up();
$attemptId = DB::table($attemptTable)->insertGetId($event + ['gateway_http_status' => 200]);
$addSummary->up();
$attempt = DB::table($attemptTable)->where('id', $attemptId);
if ($attempt->value('gateway_response') !== null) throw new RuntimeException('Upgrade fabricated a gateway summary');
$summary = json_encode(['kind' => 'object', 'message' => 'synthetic old response'], JSON_THROW_ON_ERROR);
$attempt->update(['gateway_response' => $summary]);
$callback = DB::table($callbackTable)->where('id', $callbackId);
$beforeRaw = [(array)$attempt->first(), (array)$callback->first()];

$addRaw->up();
foreach ([$attempt, $callback] as $index => $query) {
    $after = (array)$query->first();
    if (!array_key_exists('raw_diagnostic', $after) || $after['raw_diagnostic'] !== null) {
        throw new RuntimeException('Upgrade did not add nullable raw diagnostics');
    }
    unset($after['raw_diagnostic']);
    if ($after !== $beforeRaw[$index]) throw new RuntimeException('Upgrade changed historical payment diagnostics');
    $query->update(['raw_diagnostic' => '{"fixture":true}']);
}
$afterFirstUpgrade = [(array)$attempt->first(), (array)$callback->first()];
foreach ([$createAttempts, $addSummary, $addRaw] as $migration) $migration->up();
if ([(array)$attempt->first(), (array)$callback->first()] !== $afterFirstUpgrade) {
    throw new RuntimeException('Repeating the payment migrations changed stored diagnostics');
}
echo "Payment diagnostics upgrade: old callback and attempt records preserved across all three migrations and retry.\n";
