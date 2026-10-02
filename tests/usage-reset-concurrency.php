<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Services\UsageResetService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
if (($argv[1] ?? '') === 'worker') {
    try { echo json_encode((new UsageResetService())->consume((int)$argv[2], $argv[3])); }
    catch (Illuminate\Http\Exceptions\HttpResponseException $e) { echo $e->getResponse()->getContent(); }
    exit;
}
$user = User::create(['email'=>'reset-race-'.Str::uuid().'@example.com','password'=>password_hash(Str::random(24),PASSWORD_DEFAULT),
    'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'plan_id'=>App\Models\Plan::firstOrFail()->id,
    'expired_at'=>time()+86400,'transfer_enable'=>1000,'u'=>50,'d'=>50]);
$batchIds=[]; $checks=0;
$assert=function($ok,$message) use (&$checks) {if(!$ok) throw new RuntimeException($message);$checks++;};
try {
    foreach ([true,false] as $sameKey) {
        $user->update(['u'=>50,'d'=>50]);
        $grantKey=(string)Str::uuid();
        (new UsageResetService())->batch(User::where('id',$user->id),$user->id,['kind'=>'grant','request_key'=>$grantKey,'expected_count'=>1,'quantity'=>1]);
        $batchIds[]=DB::table('v2_usage_reset_batch')->where('request_key',$grantKey)->value('id');
        $key=(string)Str::uuid();$processes=[];
        DB::beginTransaction();
        User::where('id',$user->id)->lockForUpdate()->first();
        for($i=0;$i<2;$i++) {
            $pipes=[];
            $process=proc_open([PHP_BINARY,__FILE__,'worker',(string)$user->id,$sameKey ? $key : (string)Str::uuid()],
                [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
            if(!is_resource($process)) throw new RuntimeException('Cannot start worker');
            fclose($pipes[0]);$processes[]=[$process,$pipes];
        }
        DB::commit();
        $results=[];
        foreach($processes as [$process,$pipes]) {
            $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
            $assert(proc_close($process)===0,'Worker failed: '.$err);
            $result=json_decode($out,true);$assert(is_array($result),'Invalid worker output: '.$out);$results[]=$result;
        }
        $assert(count(array_filter($results,function($r){return ($r['outcome']??'')==='reset';}))===1,'Two concurrent calls consumed a reset');
        $assert((new UsageResetService())->summary($user->id)['available']===0,'Incorrect remaining count');
        $assert($user->refresh()->u===0 && $user->d===0,'Usage not reset');
        $assert(count(array_filter($results,function($r) use ($sameKey){return $sameKey ? ($r['outcome']??'')==='already_redeemed' : ($r['code']??'')==='reset_empty';}))===1,'Second call was not safely rejected/replayed');
    }
    $assert(DB::table('v2_usage_reset_log')->where('user_id',$user->id)->where('kind','use')->count()===2,'Duplicate consumption audit');
    echo "Usage reset concurrency: $checks checks passed\n";
} finally {
    while(DB::transactionLevel()) DB::rollBack();
    DB::table('v2_usage_reset_log')->where('user_id',$user->id)->delete();
    DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->delete();
    DB::table('v2_usage_reset_batch')->whereIn('id',$batchIds)->delete();
    $user->delete();
}
