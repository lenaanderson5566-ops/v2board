<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use Illuminate\Support\Facades\DB;
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
Illuminate\Support\Facades\Queue::fake();
$checks=0;$failures=[];
$assert=function($ok,$label) use (&$checks,&$failures){$checks++;if(!$ok)$failures[]=$label;};
$status=function($callback){try{$callback();return 200;}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){return $e->getStatusCode();}};
// Constructing the webhook action checks authentication without sending network traffic.
foreach (['/api/v10/webhooks/telegram','/api/v1/guest/telegram/webhook'] as $path) {
    foreach ([[null,1,md5(''),401],['',1,md5(''),401],['test-token',0,md5('test-token'),401],['test-token',1,'wrong',401],['test-token',1,md5('test-token'),200]] as [$token,$enabled,$secret,$expected]) {
        config(['v2board.telegram_bot_token'=>$token,'v2board.telegram_bot_enable'=>$enabled]);
        $r=Illuminate\Http\Request::create($path,'POST',['access_token'=>$secret],[],[],['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'=>$secret]);
        $assert($status(fn()=>new App\Services\Actions\Guest\TelegramActions($r))===$expected,'Telegram rejects missing/disabled/incorrect credentials: '.$path.' '.$expected);
    }
}
config(['v2board.telegram_bot_enable'=>0]);
$rules=(new App\Http\Requests\Admin\PlanSave())->rules();
foreach (['month_price','quarter_price','half_year_price','year_price','two_year_price','three_year_price','onetime_price','reset_price'] as $field) {
    foreach ([-1,null,0,100] as $price) {
        $valid=validator([$field=>$price],[$field=>$rules[$field]])->passes();
        $assert($valid===($price!==-1),'Admin price validation: '.$field.' '.var_export($price,true));
    }
}
DB::beginTransaction();
try {
    $u=User::create(['email'=>uniqid('audit-').'@example.com','password'=>'test','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'balance'=>0,'commission_balance'=>0]);
    $p=Plan::create(['name'=>'Audit fixture','group_id'=>1,'transfer_enable'=>10,'month_price'=>-100,'show'=>1,'renew'=>1]);
    $r=App\Http\Requests\User\OrderSave::create('/api/v10/me/orders','POST',['plan_id'=>$p->id,'period'=>'month_price']);$r->user=['id'=>$u->id];$app->instance('request',$r);
    $assert($status(fn()=>(new App\Services\Actions\User\OrderActions())->save($r))===409,'Negative configured price cannot create an order');
    $assert(Order::where('user_id',$u->id)->count()===0,'Rejected price creates no order');
    Order::where('user_id',$u->id)->delete();
    foreach ([-100,0] as $amount) {
        $o=Order::create(['user_id'=>$u->id,'plan_id'=>$p->id,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>$amount,'status'=>0,'type'=>1]);
        $r=Illuminate\Http\Request::create('/api/v10/me/orders/checkout','POST',['trade_no'=>$o->trade_no]);$r->user=['id'=>$u->id];$app->instance('request',$r);
        $assert($status(fn()=>(new App\Services\Actions\User\OrderActions())->checkout($r))===($amount<0?409:200),'Checkout amount '.$amount);
        $assert((int)$o->fresh()->status===($amount<0?0:1),'Checkout must preserve negative orders and accept legitimate free orders');
    }
} finally {DB::rollBack();}
foreach($failures as $failure) fwrite(STDERR,"FAIL: $failure\n");
echo "Backend security: $checks checks, ".count($failures)." failures; rollback.\n";
exit($failures?1:0);
