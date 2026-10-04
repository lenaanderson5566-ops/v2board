<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Services\OrderService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Http\Requests\User\OrderSave;
use App\Services\Actions\User\OrderActions as OrderController;
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
DB::beginTransaction();
try {
 $plan = Plan::create(['name'=>'Replacement test','group_id'=>1,'transfer_enable'=>100,'month_price'=>1000,'year_price'=>9000,'show'=>1,'renew'=>1]);
 $user = User::create(['email'=>Str::uuid().'@example.com','password'=>'test','token'=>Str::random(32),'uuid'=>(string)Str::uuid(),'balance'=>1500,'transfer_enable'=>0,'expired_at'=>0]);
 $save = function ($body) use ($user) {
   $request = OrderSave::create('/', 'POST', $body);
   $request->user = ['id'=>$user->id];
   return json_decode((new OrderController())->save($request)->getContent(), true)['data'];
 };
 $old = $save(['plan_id'=>$plan->id,'period'=>'month_price']);
 $assert($user->fresh()->balance === 500, 'Initial balance reservation');
 try { $save(['plan_id'=>$plan->id,'period'=>'year_price','replace_trade_no'=>$old,'coupon_code'=>'nonexistent-test-coupon']); throw new RuntimeException('Invalid coupon accepted'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {}
 $assert(Order::where('trade_no',$old)->first()->status === 0 && $user->fresh()->balance === 500, 'Failed replacement must restore order and balance');
 $new = $save(['plan_id'=>$plan->id,'period'=>'year_price','replace_trade_no'=>$old]);
 $previous = Order::where('trade_no',$old)->firstOrFail();
 $next = Order::where('trade_no',$new)->firstOrFail();
 $assert($previous->status === 2, 'Previous order cancelled');
 $assert($next->balance_amount === 1500 && $next->total_amount === 7500 && $user->fresh()->balance === 0, 'Returned balance applied exactly once');
 (new OrderService($previous))->paid('late-test');
 $assert($previous->fresh()->status === 2, 'Stale callback must not reopen replaced order');
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$old]); throw new RuntimeException('Duplicate replacement accepted'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Duplicate conflict'); }
 $next->payment_id=1; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Issued payment replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Issued payment protected'); }
 $next->payment_id=null; $next->status=1; $next->save();
 try { $save(['plan_id'=>$plan->id,'period'=>'month_price','replace_trade_no'=>$new]); throw new RuntimeException('Paid order replaced'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode() === 409, 'Paid order protected'); }
 echo "Order replacement: $checks checks passed\n";
} finally { DB::rollBack(); }

