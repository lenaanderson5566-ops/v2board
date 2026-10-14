<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use Illuminate\Support\Facades\DB;
use App\Models\{User,Coupon};
use App\Services\CouponWallet;
if(($argv[1]??'')==='worker') {
    try { echo 'ok:'.CouponWallet::issue((int)$argv[2],(int)$argv[3]); }
    catch(Symfony\Component\HttpKernel\Exception\HttpException $e) { if($e->getStatusCode()!==409)throw $e;echo 'conflict'; }
    exit;
}
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage().PHP_EOL);exit(1);});
$users=[];$coupons=[];
$run=function(array $pairs){
    $jobs=[];
    foreach($pairs as [$user,$coupon]) {
        $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'worker',(string)$user,(string)$coupon],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
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
}finally{
    DB::table('v2_coupon_wallet')->whereIn('coupon_id',$coupons)->delete();Coupon::whereIn('id',$coupons)->delete();User::whereIn('id',$users)->delete();
}
