<?php
$app = require __DIR__.'/support/bootstrap.php';
require __DIR__.'/commerce-bootstrap.php';
if(!getenv('COMMERCE_TEST_DATABASE'))throw new RuntimeException('Requires isolated database');
use Illuminate\Support\Facades\DB;
use App\Models\{User,Coupon};
use App\Services\CouponCampaign;
if(($argv[1]??'')==='worker') {
    if($argv[2]==='confirm') echo CouponCampaign::confirm($argv[3],1)['id'];
    else CouponCampaign::process();
    exit;
}
$run=function($operation,$key){
    $jobs=[];
    for($i=0;$i<2;$i++){
        $pipes=[];$process=proc_open([PHP_BINARY,__FILE__,'worker',$operation,$key],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Cannot start worker');fclose($pipes[0]);$jobs[]=[$process,$pipes];
    }
    $result=[];foreach($jobs as [$process,$pipes]){$stdout=stream_get_contents($pipes[1]);$stderr=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($process)!==0)throw new RuntimeException($stderr);$result[]=$stdout;}return $result;
};
$user=null;$coupon=null;$batch=null;
try {
    $user=User::create(['email'=>uniqid().'@example.test','password'=>'fixture','token'=>uniqid(),'uuid'=>Illuminate\Support\Str::uuid()]);
    $coupon=Coupon::create(['name'=>'Race fixture','code'=>uniqid(),'type'=>2,'value'=>10,'show'=>1,'limit_use'=>1,'started_at'=>time()-10,'ended_at'=>time()+3600]);
    $r=Illuminate\Http\Request::create('/','POST',['coupon_id'=>$coupon->id,'scope'=>'ids','user_ids'=>[$user->id]]);$r->user=['id'=>1];
    $batch=CouponCampaign::preview($r);
    $results=$run('confirm',$batch['previewKey']);
    if($results[0]!==$results[1] || (int)$coupon->fresh()->limit_use!==0)throw new RuntimeException('Concurrent confirmation reserved twice');
    $run('process','');
    if(DB::table('v2_coupon_wallet')->where('coupon_id',$coupon->id)->count()!==1 || CouponCampaign::present($batch['id'])['issued']!==1)throw new RuntimeException('Concurrent delivery duplicated wallet');
    if((int)$coupon->fresh()->limit_use!==0)throw new RuntimeException('Concurrent processing corrupted stock');
    echo "Coupon campaign concurrency: duplicate confirmation and parallel delivery passed.\n";
}finally{
    if($batch){DB::table('v2_coupon_campaign_recipient')->where('campaign_id',$batch['id'])->delete();DB::table('v2_coupon_campaign')->where('id',$batch['id'])->delete();}
    if($coupon){DB::table('v2_coupon_wallet')->where('coupon_id',$coupon->id)->delete();$coupon->delete();}
    if($user)$user->delete();
}
