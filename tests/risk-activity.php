<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\RiskRuleHit;
use App\Models\UserOnlineSnapshot;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;
$c=new App\Http\Controllers\V1\Risk\LogController;
$n=0; $assert=function($v)use(&$n){$n++;if(!$v)throw new RuntimeException('Failed '.$n);};
$decode=function($r){return json_decode($r->getContent(),true);};
config(['v2board.server_push_interval'=>60,'v2board.device_limit_mode'=>0]);
DB::beginTransaction();
$key=null;
try {
 $u=User::create(['email'=>'risk-activity-'.bin2hex(random_bytes(5)).'@example.com','password'=>'fixture','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
 $key='ALIVE_IP_USER_'.$u->id; $old=Cache::get($key);
 $u->t=time()-3600; $u->balance=12345; $u->save();
 $reportedAt=time()-5;
 UserOnlineSnapshot::create(['user_id'=>$u->id,'ip'=>'192.0.2.1','node'=>'test-node','source'=>'alive','online_at'=>$reportedAt]);
 Cache::put($key,['alive_ip'=>999,
  'test-node'=>['aliveips'=>['192.0.2.1_1','192.0.2.1_1','192.0.2.2_1'],'lastupdateAt'=>$reportedAt],
  'expired-node'=>['aliveips'=>['192.0.2.3'],'lastupdateAt'=>time()-101],
  'unstamped'=>['aliveips'=>['192.0.2.4']]],120);
 $online=$decode($c->getOnlineUsers(Request::create('/', 'GET',['email'=>$u->email,'page_size'=>1])));
 $assert($online['total']===2 && count($online['data'])===1);
 $assert($online['meta']['users']===1 && $online['meta']['ips']===2);
 $assert($online['data'][0]['ip']==='192.0.2.1');
 $assert($online['data'][0]['online_at']===$reportedAt && $online['data'][0]['alive_count']===2);
 $page=$decode($c->getOnlineUsers(Request::create('/', 'GET',['email'=>$u->email,'page_size'=>1,'current'=>2])));
 $assert($page['data'][0]['ip']==='192.0.2.2');
 $multi=Cache::get($key);$multi['other-node']=['aliveips'=>['192.0.2.1'],'lastupdateAt'=>$reportedAt];Cache::put($key,$multi,120);
 config(['v2board.device_limit_mode'=>1]);
 $online=$decode($c->getOnlineUsers(Request::create('/','GET',['email'=>$u->email])));
 $assert($online['total']===3 && $online['meta']===['users'=>1,'ips'=>2,'connections'=>3,'updated_at'=>$online['meta']['updated_at']]);
 $assert(count(array_filter($online['data'],fn($row)=>$row['alive_count']===2))===3);
 config(['v2board.device_limit_mode'=>0]);
 Cache::put($key,['expired-node'=>['aliveips'=>['192.0.2.3'],'lastupdateAt'=>time()-101]],120);
 $assert($decode($c->getOnlineUsers(Request::create('/','GET',['email'=>$u->email])))['total']===0);
 UserOnlineSnapshot::where('user_id',$u->id)->delete();
 foreach ([['192.0.2.1','test-a',time()],['192.0.2.2','test-b',time()-100]] as [$ip,$source,$at])
  UserOnlineSnapshot::create(['user_id'=>$u->id,'ip'=>$ip,'node'=>'test','source'=>$source,'online_at'=>$at]);
 $usage=$decode($c->getUserUsage(Request::create('/','GET',['email'=>$u->email])))['data'][0];
 $assert($usage['last_online_ip']==='192.0.2.1');
 $assert($usage['balance_cents']===12345);
 $at=(int)(floor(time()/600)*600);
 foreach ([0,1] as $i) RiskRuleHit::create(['user_id'=>$u->id,'email'=>'activity-test@example.com','scene'=>'subscribe','rule_key'=>'test_activity','risk_level'=>'low','ip'=>'192.0.2.1','status'=>'recorded','hit_at'=>$at+$i]);
 $group=$decode($c->getRuleHits(Request::create('/','GET',['grouped'=>1,'email'=>'activity-test@example.com'])));
 $assert($group['total']===1 && $group['data'][0]['hit_count']===2);
 $assert($group['data'][0]['first_hit_at']===$at);
 $raw=$decode($c->getRuleHits(Request::create('/','GET',['email'=>'activity-test@example.com'])));
 $assert($raw['total']===2);
 $activity=$decode($c->getUserActivity(Request::create('/','GET',['user_id'=>$u->id])))['data'];
 $assert($activity['user']['id']===$u->id && !isset($activity['user']['token']));
 $assert(count(array_filter($activity['events'],fn($r)=>($r['rule_key']??'')==='test_activity'))===2);
 $r=Request::create('/api/v1/'.config('v2board.ops_api_path','ops').'/risk/user-activity/fetch?user_id='.$u->id);
 $r->headers->set('Accept','application/json');
 $assert(app(Illuminate\Contracts\Http\Kernel::class)->handle($r)->getStatusCode()===403);
} finally {
 DB::rollBack();
 if($key) {if($old===null)Cache::forget($key);else Cache::put($key,$old,600);}
}
echo "PASS: {$n} risk activity checks\n";
