<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use App\Models\Order;
use App\Http\Resources\V10\Resource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
$checks=0;$original=config('v2board');
$assert=function($v,$msg)use(&$checks){if(!$v)throw new RuntimeException($msg);$checks++;};
DB::beginTransaction();
try {
 config(['v2board.currency'=>'USD','v2board.currency_symbol'=>'$']);
 $o=Order::create(['user_id'=>2147483000,'plan_id'=>0,'period'=>'deposit','trade_no'=>'cny-test-'.uniqid(),'total_amount'=>2880,'status'=>0,'type'=>1]);
 $assert($o->fresh()->currency==='CNY','New order currency changed');
 DB::table('v2_order')->insert(['user_id'=>2147483000,'plan_id'=>0,'period'=>'deposit','trade_no'=>'cny-legacy-'.uniqid(),'total_amount'=>1234,'status'=>0,'type'=>1,'created_at'=>time(),'updated_at'=>time()]);
 $assert(DB::table('v2_order')->where('user_id',2147483000)->where('total_amount',1234)->value('currency')==='CNY','Legacy writer default not CNY');
 $assert($o->fresh()->total_amount==2880,'Amount changed');
 $assert(Resource::encode('order',$o->fresh()->toArray())['currency']==='CNY','Order mislabeled by global config');
 $assert(Resource::encode('plan',['id'=>1,'month_price'=>2880])['currency']==='CNY','Plan mislabeled');
 $assert(Resource::encode('account',['balance'=>500])['currency']==='CNY','Balance mislabeled');
 $assert(Resource::encode('commission',['get_amount'=>100])['currency']==='CNY','Commission mislabeled');
 $prefs=json_decode((new App\Services\Actions\User\CommActions())->config()->getContent(),true)['data'];
 $assert($prefs['currency']==='CNY' && $prefs['currency_symbol']==='CNY','Preferences override allowed');
 foreach(['currency'=>'USD','currency_symbol'=>'$'] as $key=>$value) $assert(Validator::make([$key=>$value],App\Http\Requests\Admin\ConfigSave::RULES)->fails(),'Unsafe admin currency accepted');
 $assert(Validator::make(['currency'=>'CNY','currency_symbol'=>'CNY'],App\Http\Requests\Admin\ConfigSave::RULES)->passes(),'CNY config rejected');
 $rejected=false;try {Order::create(['currency'=>'USD']);}catch(InvalidArgumentException $e){$rejected=true;}
 $assert($rejected,'USD order enabled prematurely');
 $assert(App\Services\Money::format(2880)==='CNY 28.80','Money format incorrect');
 echo "CNY currency: $checks checks passed; rollback.\n";
} finally {DB::rollBack();config(['v2board'=>$original]);}
