<?php
$app = require __DIR__.'/support/bootstrap.php';
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Cache;
use Illuminate\Database\Schema\Blueprint;
use App\Http\Requests\Admin\UserFetch;
use App\Http\Controllers\V1\Admin\UserController;
config(['database.default' => 'activity_test', 'database.connections.activity_test' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => ''], 'cache.default' => 'array']);
Cache::setDefaultDriver('array');
config(['fastai.server_push_interval'=>60,'fastai.device_limit_mode'=>0]);
Schema::create('v2_user', function (Blueprint $table) {
    $table->increments('id'); $table->string('email'); $table->integer('invite_user_id')->nullable();
    foreach (['t', 'last_login_at', 'created_at', 'plan_id', 'u', 'd'] as $key) $table->integer($key)->default(0);
    $table->string('token')->default('test-token');
    $table->string('currency')->default('CNY');
    $table->integer('credit_balance')->default(0);
});
Schema::create('v2_plan', function (Blueprint $table) {$table->increments('id'); $table->string('name');});
Schema::create('v2_order', function (Blueprint $table) {
    $table->increments('id');
    $table->integer('user_id');
    $table->integer('plan_id');
    $table->string('period');
    $table->string('currency');
    $table->integer('status');
    $table->integer('total_amount');
    $table->integer('handling_amount')->default(0);
    $table->integer('surplus_amount')->default(0);
    $table->integer('paid_at')->nullable();
    $table->integer('payment_id')->nullable();
    $table->string('callback_no')->nullable();
});
Schema::create('v2_user_online_snapshot', function (Blueprint $table) {
    $table->increments('id'); $table->integer('user_id'); $table->string('source'); $table->integer('online_at');
});
Schema::create('v2_subscribe_log', function (Blueprint $table) {
    $table->increments('id'); $table->integer('user_id'); $table->integer('created_at');
});
DB::table('v2_subscribe_log')->insert([
    ['user_id' => 2, 'created_at' => 180],
    ['user_id' => 2, 'created_at' => 160],
    ['user_id' => 3, 'created_at' => 190],
]);
DB::table('v2_user')->insert([
    ['id' => 1, 'email' => 'inviter@example.com', 'invite_user_id' => null, 't' => 0, 'last_login_at' => 123],
    ['id' => 2, 'email' => 'guest@example.com', 'invite_user_id' => 1, 't' => 100, 'last_login_at' => 120],
    ['id' => 3, 'email' => 'traffic@example.com', 'invite_user_id' => null, 't' => 200, 'last_login_at' => 0],
]);
DB::table('v2_user')->where('id', 3)->update(['currency' => 'USD']);
$recharge = [
    'user_id' => 2, 'plan_id' => 0, 'period' => 'deposit', 'currency' => 'CNY',
    'status' => 3, 'total_amount' => 1250, 'handling_amount' => 50, 'surplus_amount' => 0,
    'paid_at' => 100, 'payment_id' => 1, 'callback_no' => 'gateway-reference',
];
DB::table('v2_order')->insert(array_map(fn ($overrides) => array_replace($recharge, $overrides), [
    [],
    ['total_amount' => 750, 'paid_at' => 200, 'callback_no' => 'another-gateway-reference'],
    ['user_id' => 3, 'currency' => 'USD', 'total_amount' => 625],
    ['user_id' => 3, 'total_amount' => 2000], // Mismatched historical order currency.
    ['status' => 0],
    ['status' => 1],
    ['status' => 2],
    ['period' => 'month_price', 'plan_id' => 1],
    ['plan_id' => 1],
    ['callback_no' => 'manual_operation'],
    ['callback_no' => ' '],
    ['paid_at' => null],
    ['payment_id' => null],
    ['callback_no' => '佣金划转 Commission transfer'],
    ['total_amount' => 0, 'surplus_amount' => 500, 'paid_at' => null, 'payment_id' => null,
        'callback_no' => '佣金划转 Commission transfer'],
]));
DB::table('v2_user_online_snapshot')->insert([
    ['user_id' => 2, 'source' => 'alive', 'online_at' => 150],
    ['user_id' => 2, 'source' => 'subscribe', 'online_at' => 999],
    ['user_id' => 3, 'source' => 'alive', 'online_at' => 100],
]);
Cache::put('ALIVE_IP_USER_1','corrupt-cache');
Cache::put('ALIVE_IP_USER_2',['alive_ip'=>999,
    'v2box_1'=>['aliveips'=>['192.0.2.1_1','192.0.2.1_1','192.0.2.2_1'],'lastupdateAt'=>time()],
    'stale'=>['aliveips'=>['192.0.2.3_2'],'lastupdateAt'=>time()-101],
    'invalid'=>['aliveips'=>'corrupt','lastupdateAt'=>time()], 'unstamped'=>['aliveips'=>['192.0.2.4']]]);
$request = UserFetch::create('/', 'GET', ['sort' => 'id', 'sort_type' => 'ASC']);
$request->setContainer(app())->setRedirector(app('redirect'));
DB::enableQueryLog(); DB::flushQueryLog();
$data = json_decode((new UserController())->fetch($request)->getContent(), true)['data'];
$assert = function ($ok, $message = 'Activity projection failed') {if (!$ok) throw new RuntimeException($message);};
$assert($data[0]['alive_ip']===0 && $data[1]['alive_ip']===2 && str_contains($data[1]['ips'],'192.0.2.1'));
$assert(!str_contains($data[1]['ips'],'192.0.2.3') && !str_contains($data[1]['ips'],'192.0.2.4'));
$assert($data[0]['last_connected_at'] === null && $data[0]['last_login_at'] === 123);
$assert($data[1]['last_connected_at'] === 150 && $data[1]['last_login_at'] === 120);
$assert($data[1]['invite_email'] === 'inviter@example.com');
$assert($data[2]['last_connected_at'] === 200);
$assert($data[0]['last_subscribe_at'] === null);
$assert($data[1]['last_subscribe_at'] === 180 && $data[2]['last_subscribe_at'] === 190);
$assert(count(array_filter(DB::getQueryLog(), fn ($query) => str_contains($query['query'], 'v2_subscribe_log'))) === 1);
$assert(count(array_filter(DB::getQueryLog(), fn ($query) => str_contains($query['query'], 'v2_user_online_snapshot'))) === 1);
$assert(array_column($data, 'total_recharge_amount') === [0, 2000, 625],
    'Only completed external top-up principal is counted in the account currency');
$assert(count(array_filter(DB::getQueryLog(), fn ($query) => str_contains($query['query'], 'v2_order'))) === 1,
    'Recharge totals are fetched with one grouped query for the page');
echo "User activity columns: identity, timestamps, source filtering and batched lookup passed\n";

for ($id = 4; $id <= 113; $id++) {
    DB::table('v2_user')->insert(['id'=>$id,'email'=>'page'.$id.'@example.test','invite_user_id'=>null,'t'=>0,'last_login_at'=>0]);
}
foreach ([[1000, -2, 100, 1], [1, 1, 10, 1], [20, 2, 20, 21]] as [$size, $page, $expectedCount, $firstId]) {
    $request = UserFetch::create('/', 'GET', ['sort'=>'id','sort_type'=>'ASC','pageSize'=>$size,'current'=>$page]);
    $request->setContainer(app())->setRedirector(app('redirect'));
    $result = json_decode((new UserController())->fetch($request)->getContent(), true);
    $assert($result['total'] === 113 && count($result['data']) === $expectedCount);
    $assert($result['data'][0]['id'] === $firstId);
}
echo "User pagination: bounded size, negative page and page offsets passed\n";
