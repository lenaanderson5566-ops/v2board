<?php
require __DIR__.'/../vendor/autoload.php';$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('local'))throw new RuntimeException('Local browser review only');
use App\Models\User;use App\Models\Plan;use App\Models\Order;use Illuminate\Support\Facades\DB;
$file=storage_path('framework/traffic-credit-review.json');$action=$argv[1]??'';
if($action==='setup'){
 if(is_file($file))throw new RuntimeException('Restore earlier review first');
 $user=User::where('email','test@example.com')->where('is_admin',0)->firstOrFail();
 file_put_contents($file,json_encode(['id'=>$user->id,'fields'=>$user->only(['plan_id','group_id','expired_at','transfer_enable','u','d','credit_balance'])],JSON_THROW_ON_ERROR));
 DB::transaction(function()use($user){
  $plan=Plan::create(['name'=>'Pro','group_id'=>0,'transfer_enable'=>100,'month_price'=>2880,'onetime_price'=>2000,'show'=>1,'renew'=>1,'reset_traffic_method'=>0]);
  $user->update(['plan_id'=>$plan->id,'group_id'=>0,'transfer_enable'=>100*1073741824,'u'=>1073741824,'d'=>18*1073741824,'expired_at'=>time()+86400*90,'credit_balance'=>50*1073741824]);
  foreach([2,3]as$status)Order::create(['user_id'=>$user->id,'plan_id'=>$plan->id,'trade_no'=>'credit-review-'.$status,'period'=>'month_price','type'=>1,'status'=>$status,'total_amount'=>880,'balance_amount'=>2000,'paid_at'=>$status===3?time():null]);
 });
}elseif($action==='standalone'){
 if(!is_file($file))throw new RuntimeException('Setup required');$backup=json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR);
 User::where('id',$backup['id'])->where('email','test@example.com')->update(['expired_at'=>time()-1]);
}elseif($action==='cleanup'){
 if(!is_file($file))throw new RuntimeException('No backup found');$backup=json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR);
 DB::transaction(function()use($backup){$user=User::where('id',$backup['id'])->where('email','test@example.com')->firstOrFail();$plan=$user->plan_id;Order::where('user_id',$user->id)->whereIn('trade_no',['credit-review-2','credit-review-3'])->delete();$user->update($backup['fields']);if(!User::where('plan_id',$plan)->exists()&&!Order::where('plan_id',$plan)->exists())Plan::where('id',$plan)->delete();});unlink($file);
}else throw new RuntimeException('Use setup/standalone/cleanup');echo "Credit UI review: $action complete\n";
