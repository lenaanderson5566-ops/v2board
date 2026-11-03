<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use Illuminate\Support\Facades\DB;
use App\Models\{User,Coupon,Order,Plan};
use App\Services\{CouponWallet,OrderService,PlanService};
use App\Services\Actions\User\OrderActions;
use App\Http\Requests\User\OrderSave;
$orderRequest=function(int $userId,int $planId,array $extra=[]){
    $request=OrderSave::create('/api/v10/me/orders','POST',$extra+['plan_id'=>$planId,'period'=>'month_price']);
    $request->user=['id'=>$userId];
    return $request;
};
if(($argv[1]??'')==='worker') {
    try { echo 'ok:'.CouponWallet::issue((int)$argv[2],(int)$argv[3]); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e) { if($e->getStatusCode()!==409)throw $e;echo 'conflict'; }
    exit;
}
if(($argv[1]??'')==='order-worker') {
    $request=$orderRequest((int)$argv[2],(int)$argv[3]);
    app()->instance('request',$request);
    try { echo 'ok:'.json_decode((new OrderActions())->save($request)->getContent(),true)['data']; }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e) {
        if($e->getStatusCode()!==409 || $e->getMessage()!==__('Current product is sold out'))throw $e;
        echo 'conflict';
    }
    exit;
}
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage().PHP_EOL);exit(1);});
$users=[];$coupons=[];$plan=null;
$run=function(array $pairs,string $worker='worker'){
    $jobs=[];
    foreach($pairs as [$user,$coupon]) {
        $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,$worker,(string)$user,(string)$coupon],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Cannot start worker');fclose($pipes[0]);$jobs[]=[$process,$pipes];
    }
    $out=[];foreach($jobs as [$process,$pipes]){$stdout=stream_get_contents($pipes[1]);$stderr=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($process);if($code!==0)throw new RuntimeException('Worker failed: '.$stderr);$out[]=$stdout;}return $out;
};
try {
    for($i=0;$i<2;$i++)$users[]=User::create(['email'=>'race-'.uniqid().'@example.test','password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid()])->id;
    foreach([1,2] as $stock)$coupons[]=Coupon::create(['name'=>'Concurrency fixture','code'=>uniqid(),'type'=>2,'value'=>10,'show'=>1,'public_claim'=>1,'limit_use'=>$stock,'started_at'=>time()-10,'ended_at'=>time()+3600])->id;
    $out=$run([[$users[0],$coupons[0]],[$users[1],$coupons[0]]]);
    if(count(array_filter($out,fn($v)=>str_starts_with($v,'ok:')))!==1 || (int)Coupon::find($coupons[0])->limit_use!==0)throw new RuntimeException('Coupon oversold');
    $out=$run([[$users[0],$coupons[1]],[$users[0],$coupons[1]]]);
    if($out[0]!==$out[1] || !str_starts_with($out[0],'ok:') || (int)Coupon::find($coupons[1])->limit_use!==1)throw new RuntimeException('Concurrent claim not idempotent');
    if(DB::table('v2_coupon_wallet')->whereIn('coupon_id',$coupons)->count()!==2)throw new RuntimeException('Duplicate wallet entries');
    echo "Commerce concurrency: stock cannot oversell; duplicate claims return one wallet entry.\n";

    $plan=Plan::create(['name'=>'One seat','group_id'=>1,'transfer_enable'=>1,'month_price'=>100,'onetime_price'=>100,'show'=>1,'renew'=>1,'capacity_limit'=>1]);
    User::whereIn('id',$users)->update(['plan_id'=>$plan->id,'expired_at'=>time()-86400]);
    $legacy=Order::create(['user_id'=>$users[0],'plan_id'=>$plan->id,'trade_no'=>uniqid('legacy-seat-'),
        'period'=>'onetime_price','status'=>0,'type'=>1,'total_amount'=>100]);
    if($run([[$users[1],$plan->id]],'order-worker')!==['conflict'])throw new RuntimeException('Legacy base onetime order did not hold its seat');
    if(!(new OrderService($legacy))->cancel())throw new RuntimeException('Legacy fixture failed to cancel');

    $out=$run([[$users[0],$plan->id],[$users[1],$plan->id]],'order-worker');
    if(count(array_filter($out,fn($v)=>str_starts_with($v,'ok:')))!==1 || count(array_filter($out,fn($v)=>$v==='conflict'))!==1)
        throw new RuntimeException('Concurrent orders exceeded plan capacity');
    $winner=$out[0]==='conflict'?1:0;
    $held=Order::where('trade_no',substr($out[$winner],3))->firstOrFail();
    $catalog=new App\Services\Actions\User\PlanActions();
    foreach ([[],['id'=>$plan->id]] as $selector) {
        $request=Illuminate\Http\Request::create('/api/v10/plans','GET',$selector+['user'=>['id'=>$users[1-$winner]]]);
        $catalogData=json_decode($catalog->fetch($request)->getContent(),true)['data'];
        $available=$selector?$catalogData:collect($catalogData)->firstWhere('id',$plan->id);
        if(($available['capacity_limit']??null)!==0)throw new RuntimeException('Catalog did not account for the reserved seat');
    }
    $request=$orderRequest($users[$winner],$plan->id,['replace_trade_no'=>$held->trade_no]);
    if((new OrderActions())->quote($request)->getStatusCode()!==200)throw new RuntimeException('Replacement quote counted its own seat twice');
    if(!(new OrderService($held))->cancel())throw new RuntimeException('Held seat did not cancel');
    $out=$run([[$users[1-$winner],$plan->id]],'order-worker');
    if(!str_starts_with($out[0],'ok:'))throw new RuntimeException('Cancellation did not release capacity');
    $paid=Order::where('trade_no',substr($out[0],3))->firstOrFail();
    (new OrderService($paid))->paid('capacity-fixture');
    if($run([[$users[$winner],$plan->id]],'order-worker')!==['conflict'])throw new RuntimeException('Paid but unfulfilled order released capacity');
    (new OrderService($paid->fresh()))->open();
    if($run([[$users[$winner],$plan->id]],'order-worker')!==['conflict'])throw new RuntimeException('Fulfilled seat no longer counted');
    $out=$run([[$users[1-$winner],$plan->id]],'order-worker');
    if(!str_starts_with($out[0],'ok:') || (int)PlanService::countOccupiedSeats((int)$plan->id)[$plan->id]->count!==1)
        throw new RuntimeException('Active same-plan renewal consumed a second seat');
    echo "Commerce concurrency: one order can reserve the last plan seat; cancellation releases it and fulfillment and renewal retain it.\n";
}finally{
    if($plan){Order::where('plan_id',$plan->id)->delete();$plan->delete();}
    DB::table('v2_coupon_wallet')->whereIn('coupon_id',$coupons)->delete();Coupon::whereIn('id',$coupons)->delete();User::whereIn('id',$users)->delete();
}
