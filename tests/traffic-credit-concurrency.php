<?php
require __DIR__.'/../vendor/autoload.php';$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('local'))throw new RuntimeException('Local test only');
use App\Models\User;use App\Models\Order;use Illuminate\Support\Facades\DB;use Illuminate\Support\Str;
if(($argv[1]??'')==='worker'){
 (new App\Services\OrderService(Order::findOrFail($argv[2])))->open();echo 'ok';exit;
}
$plan=App\Models\Plan::firstOrFail();
$user=User::create(['email'=>'credits-race-'.Str::uuid().'@example.com','password'=>'local-test-only','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'plan_id'=>$plan->id,'group_id'=>1,'expired_at'=>time()+86400,'transfer_enable'=>1000,'credit_balance'=>200]);
$order=Order::create(['user_id'=>$user->id,'plan_id'=>$plan->id,'trade_no'=>Str::random(24),'period'=>'onetime_price','type'=>5,'status'=>1,'total_amount'=>100,'credit_bytes'=>500,'credit_snapshot'=>['name'=>'Race','group_id'=>1,'speed_limit'=>100,'device_limit'=>4]]);
$processes=[];
try {
 DB::beginTransaction();User::where('id',$user->id)->lockForUpdate()->first();
 for($i=0;$i<2;$i++){
  $pipes=[];$p=proc_open([PHP_BINARY,__FILE__,'worker',(string)$order->id],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
  if(!is_resource($p))throw new RuntimeException('Worker unavailable');fclose($pipes[0]);$processes[]=[$p,$pipes];
 }
 DB::commit();
 foreach($processes as [$p,$pipes]){$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($p)!==0||$out!=='ok')throw new RuntimeException('Worker failed: '.$out.$err);}
 if($user->refresh()->credit_balance!==700 || $order->fresh()->status!==3 || DB::table('v2_traffic_credit_log')->where('reference','order:'.$order->id)->count()!==1)throw new RuntimeException('Concurrent fulfillment credited twice');
 echo "Traffic credit concurrency: two workers, one grant passed\n";
}finally{while(DB::transactionLevel())DB::rollBack();DB::table('v2_traffic_credit_log')->where('user_id',$user->id)->delete();$order->delete();$user->delete();}
