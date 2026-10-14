<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\User;
use Illuminate\Support\Str;
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
$user=User::create(['email'=>'batch-race-'.Str::uuid().'@example.test','password'=>'test','uuid'=>(string)Str::uuid(),'token'=>Str::random(32),'u'=>0,'d'=>0,'transfer_enable'=>100000,'expired_at'=>time()+86400,'group_id'=>1]);
$nodeId=random_int(1500000000,2000000000);$uuid=(string)Str::uuid();$processes=[];
try {
 for($i=0;$i<3;$i++) {
  $process=proc_open([PHP_BINARY,__DIR__.'/node-traffic-batch-worker.php',(string)$nodeId,$uuid,(string)$user->id],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
  if(!is_resource($process))throw new RuntimeException('Worker could not start');
  fclose($pipes[0]);$processes[]=[$process,$pipes];
 }
 foreach($processes as [$process,$pipes]) {
  $output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
  if(proc_close($process)!==0)throw new RuntimeException($output);
 }
 if($user->refresh()->u!==200 || $user->d!==100)throw new RuntimeException('Concurrent retry duplicated billing');
 if(DB::table('v2_node_traffic_batch')->where('node_id',$nodeId)->count()!==1)throw new RuntimeException('Concurrent receipt duplicated');
 $stat=DB::table('v2_stat_server')->where('server_id',$nodeId)->where('server_type','v2box')->first();
 if(!$stat || $stat->u!==100 || $stat->d!==50)throw new RuntimeException('Concurrent retry duplicated server statistics');
 echo "Node traffic concurrency: 3 workers passed\n";
} finally {
 DB::table('v2_node_traffic_batch')->where('node_id',$nodeId)->delete();
 DB::table('v2_stat_server')->where('server_id',$nodeId)->where('server_type','v2box')->delete();
 DB::table('v2_stat_user')->where('user_id',$user->id)->delete();$user->delete();
}
