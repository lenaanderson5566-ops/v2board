<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local tests only');
set_exception_handler(function(Throwable $e){fwrite(STDERR,(string)$e);exit(1);});
use App\Models\User;
use App\Models\Order;
use Illuminate\Support\Facades\DB;
if (($argv[1]??'')==='worker') {
    $r=App\Http\Requests\User\UserTransfer::create('/api/v10/me/commission-transfers','POST',['transfer_amount'=>1000]);
    $r->user=['id'=>(int)$argv[2]];$app->instance('request',$r);
    echo "ready\n";fflush(STDOUT);fgets(STDIN);
    try {(new App\Services\Actions\User\UserActions())->transfer($r);echo '200';}
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {echo $e->getStatusCode();}
    exit;
}
$u=User::create(['email'=>uniqid('transfer-race-').'@example.com','password'=>'test','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'balance'=>0,'commission_balance'=>1000]);
$processes=[];
try {
    DB::beginTransaction();User::whereKey($u->id)->lockForUpdate()->first();
    // Simulate a wallet credit that commits while transfers are waiting.
    User::whereKey($u->id)->update(['balance'=>500]);
    for($i=0;$i<2;$i++) {
        $process=proc_open([PHP_BINARY,__FILE__,'worker',(string)$u->id],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Worker unavailable');
        stream_set_timeout($pipes[1],10);
        $processes[]=[$process,$pipes];
        if(trim(fgets($pipes[1]))!=='ready')throw new RuntimeException('Worker not ready');
    }
    foreach($processes as [$process,$pipes]) {fwrite($pipes[0],"go\n");fflush($pipes[0]);fclose($pipes[0]);}
    // Hold the row while both workers enter their competing transactions.
    usleep(500000);DB::commit();
    $results=[];
    foreach($processes as [$process,$pipes]) {
        $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0)throw new RuntimeException('Worker failed: '.$err.' '.$out);
        $results[]=(int)$out;
    }
    $processes=[];sort($results);
    $count=Order::where('user_id',$u->id)->count();$u->refresh();
    if($results!==[200,409] || $count!==1 || (int)$u->balance!==1500 || (int)$u->commission_balance!==0)
        throw new RuntimeException('Concurrent transfer results='.json_encode($results).', orders='.$count.', balance='.$u->balance.', commission='.$u->commission_balance);
    echo "Commission transfer concurrency: one success, one conflict, one ledger record, conserved balance.\n";
} finally {
    while(DB::transactionLevel())DB::rollBack();
    foreach($processes as [$process,$pipes])if(is_resource($process)){proc_terminate($process);proc_close($process);}
    Order::where('user_id',$u->id)->delete();$u->delete();
}
