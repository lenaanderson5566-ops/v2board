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
 $processes=[];$start=microtime(true)+1;
 foreach ([[$nodeId,'192.0.2.11'],[$nodeId+1,'192.0.2.12']] as [$onlineNode,$ip]) {
  $process=proc_open([PHP_BINARY,__DIR__.'/node-traffic-batch-worker.php',(string)$onlineNode,$uuid,(string)$user->id,'online',$ip,(string)$start],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
  if(!is_resource($process))throw new RuntimeException('Online worker could not start');
  fclose($pipes[0]);$processes[]=[$process,$pipes];
 }
 foreach($processes as [$process,$pipes]) {
  $output=stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
  if(proc_close($process)!==0)throw new RuntimeException($output);
 }
 $presence=new App\Services\OnlineDeviceService();$online=$presence::forUser($user->id);
 if($online['count']!==2 || count($online['nodes'])!==2)throw new RuntimeException('Concurrent nodes overwrote the same user presence');
 if(App\Models\UserOnlineSnapshot::where('user_id',$user->id)->where('source','alive')->count()!==1)throw new RuntimeException('Concurrent nodes duplicated the historical user snapshot');
 if(App\Models\UserConnectionLog::where('user_id',$user->id)->where('source','alive')->count()!==2)throw new RuntimeException('Repeated concurrent snapshots duplicated connection logs');
 $presence->replace('v2box',$nodeId,[],3600);
 if($presence::forUser($user->id)['count']!==1)throw new RuntimeException('Clearing a concurrent node erased another node');
 $presence->replace('v2box',$nodeId+1,[],3600);
 if($presence::forUser($user->id)['count']!==0)throw new RuntimeException('Empty concurrent node snapshots did not clear presence');
 if($user->refresh()->u!==200 || $user->d!==100)throw new RuntimeException('Online reporting changed billed traffic');
 echo "Node online concurrency: 2 nodes x 12 overlapping reports passed\n";
} finally {
 foreach ([[$nodeId,'192.0.2.11'],[$nodeId+1,'192.0.2.12']] as [$onlineNode,$ip]) {
  Illuminate\Support\Facades\Cache::forget('ALIVE_NODE_USERS:v2box'.$onlineNode);
  Illuminate\Support\Facades\Cache::forget(sprintf('USER_CONNECTION_LOG:%d:%s:%s',$user->id,md5($ip),'v2box'.$onlineNode));
 }
 Illuminate\Support\Facades\Cache::forget('ALIVE_IP_USER_'.$user->id);
 App\Models\UserOnlineSnapshot::where('user_id',$user->id)->delete();
 App\Models\UserConnectionLog::where('user_id',$user->id)->delete();
 DB::table('v2_node_traffic_batch')->where('node_id',$nodeId)->delete();
 DB::table('v2_stat_server')->where('server_id',$nodeId)->where('server_type','v2box')->delete();
 DB::table('v2_stat_user')->where('user_id',$user->id)->delete();$user->delete();
}
