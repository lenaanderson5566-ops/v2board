<?php
$app = require __DIR__.'/support/bootstrap.php';
if(!app()->environment('local'))throw new RuntimeException('Local test only');
use App\Services\ServerTrafficBudgetService as Budgets;
use App\Services\Actions\NodeTrafficBatch as Batches;
use App\Http\Controllers\V1\Admin\ServerTrafficBudgetController as Admin;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Carbon\CarbonImmutable;
set_exception_handler(function($e){fwrite(STDERR,$e->getMessage()."\n");exit(1);});
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
config(['cache.default'=>'array','v2board.server_token'=>'budget-test']);Queue::fake();DB::beginTransaction();
try{
 $base=['name'=>'Budget node '.Str::uuid(),'group_id'=>[999997],'host'=>'example.test','port'=>'443','server_port'=>443,'protocol'=>'vless','network'=>'tcp','tls'=>0,'rate'=>2,'show'=>1,'disable_sni'=>0,'zero_rtt_handshake'=>0];
 (new App\Http\Controllers\V1\Admin\Server\V2boxController())->save(Request::create('/','POST',$base));
 $box=App\Models\ServerV2box::where('name',$base['name'])->firstOrFail();
 $base['name'].=' legacy';(new App\Http\Controllers\V1\Admin\Server\V2nodeController())->save(Request::create('/','POST',$base));$legacy=App\Models\ServerV2node::where('name',$base['name'])->firstOrFail();
 $user=App\Models\User::create(['email'=>'budget-'.Str::uuid().'@example.test','password'=>'test','uuid'=>(string)Str::uuid(),'token'=>Str::random(32),'group_id'=>999997,'transfer_enable'=>100000,'expired_at'=>time()+86400,'u'=>0,'d'=>0]);
 $day=strtotime(date('Y-m-d'));
 DB::table('v2_stat_server')->insert(['server_id'=>$box->id,'server_type'=>'v2box','u'=>10,'d'=>20,'record_type'=>'d','record_at'=>$day,'created_at'=>time(),'updated_at'=>time()]);
 $pendingId=Batches::receive($box,(string)Str::uuid(),[$user->id=>[5,5]]);
 $settings=['name'=>'Physical server','limitBytes'=>100,'countingMode'=>'both','resetDay'=>1,'nodes'=>[['type'=>'v2box','id'=>$box->id],['type'=>'v2node','id'=>$legacy->id]]];
 $admin=new Admin();$r=$admin->save(Request::create('/','POST',$settings));$id=json_decode($r->getContent(),true)['data']['id'];$settings['id']=$id;
 $assert(Budgets::forNode('v2box',$box->id)['usedBytes']===40,'History and pending batches imported');
 Batches::process($pendingId);$assert(Budgets::forNode('v2box',$box->id)['usedBytes']===40,'Processing imported batch does not count twice');
 $admin->save(Request::create('/','POST',$settings));$assert(Budgets::forNode('v2box',$box->id)['usedBytes']===40,'Saving quota does not import history twice');
 $batchUuid=(string)Str::uuid();Batches::receive($box,$batchUuid,[$user->id=>[20,20]]);Batches::receive($box,$batchUuid,[$user->id=>[20,20]]);
 $assert(Budgets::forNode('v2box',$box->id)['usedBytes']===80,'Deduplication covers server quota at receipt');
 (new App\Jobs\StatServerJob([$user->id=>[10,10]],$legacy->toArray(),'v2node'))->handle();
 $state=Budgets::forNode('v2box',$box->id);$assert($state['usedBytes']===100 && $state['blocked'],'Shared V2Node and V2Box reach quota');
 $assert(Budgets::blocked('v2node',$legacy->id),'Legacy node shares restriction');
 $legacyRequest=Request::create('/','GET');$response=(new App\Services\Actions\NodeCommunication($legacy,'v2node'))->user($legacyRequest);$assert(json_decode($response->getContent(),true)['users']===[],'Legacy users blocked without protocol changes');
 $controller=new App\Http\Controllers\V10\NodeController();$request=Request::create('/','GET',[],[],[],['HTTP_X_NODE_TYPE'=>'v2box','HTTP_X_NODE_ID'=>(string)$box->id]);
 $assert(json_decode($controller->users($request)->getContent(),true)['data']===[],'V10 users blocked');
 $settings['limitBytes']=200;$admin->save(Request::create('/','POST',$settings));
 $assert(!Budgets::blocked('v2box',$box->id),'Raising quota restores access without zeroing usage');
 $assert(count(json_decode($controller->users($request)->getContent(),true)['data'])===1,'V10 authentication restored');
 $settings['limitBytes']=0;$admin->save(Request::create('/','POST',$settings));$assert(!Budgets::blocked('v2box',$box->id),'Unlimited restores access');
 $settings['countingMode']='download';$admin->save(Request::create('/','POST',$settings));$assert(Budgets::forNode('v2box',$box->id)['usedBytes']===55,'Direction applies to raw traffic without multiplier');
 $summary=json_decode($admin->fetch(Request::create('/'))->getContent(),true)['data'];$row=collect($summary)->firstWhere('id',$id);$assert($row['thisMonth']['uploadBytes']===45 && $row['last30Days']['downloadBytes']===55,'Monthly and 30-day statistics');
 [$start,$end]=Budgets::period(15,CarbonImmutable::parse('2026-10-11 10:00:00'));$assert($start->format('Y-m-d')==='2026-09-15' && $end->format('Y-m-d')==='2026-10-15','Billing anniversary period');
 [$start,$end]=Budgets::period(1,CarbonImmutable::parse('2026-10-11'));$assert($start->format('Y-m-d')==='2026-10-01' && $end->format('Y-m-d')==='2026-11-01','Calendar month');
 CarbonImmutable::setTestNow(CarbonImmutable::now()->addMonth());$assert(Budgets::forNode('v2box',$box->id)['usedBytes']===0,'Next period automatically clears active usage');CarbonImmutable::setTestNow();
 try{$admin->save(Request::create('/','POST',array_merge($settings,['resetDay'=>29])));throw new RuntimeException('Bad day accepted');}catch(Illuminate\Validation\ValidationException $e){$checks++;}
 $other=$settings;unset($other['id']);try{$admin->save(Request::create('/','POST',$other));throw new RuntimeException('Node assigned twice');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Binding ownership enforced');}
 // Backend conversion keeps the physical server identity and accumulated usage.
 $converted=App\Services\Actions\ConvertNodeBackend::run('v2box',$box->id,'v2node',array_merge($base,['name'=>'Converted budget node','route_id'=>[],'up_mbps'=>0,'down_mbps'=>0]));
 $assert(Budgets::forNode('v2node',$converted->id)['id']===$id,'Conversion retains server binding');
 $assert(Budgets::forNode('v2node',$converted->id)['usedBytes']===55,'Conversion retains accumulated usage');

 // Physical server editing owns quota configuration atomically, without resetting usage.
 $physical=DB::table('v2_network_server')->insertGetId(['name'=>'Quota machine','family'=>'ipv4','enabled'=>true]);
 foreach([[$converted->id,'v2node'],[$legacy->id,'v2node']] as [$nodeId,$type])DB::table('v2_node_ddns')->insert(['credential_id'=>999999,'node_type'=>$type,'node_id'=>$nodeId,'domain'=>'quota-'.$nodeId.'.example.test','family'=>'ipv4','server_id'=>$physical]);
 $network=new App\Http\Controllers\V1\Admin\NetworkServerController();
 $physicalSettings=['id'=>$physical,'name'=>'Renamed machine','family'=>'ipv4','enabled'=>true,'traffic'=>['limitBytes'=>200,'countingMode'=>'download','resetDay'=>1]];
 $network->save(Request::create('/','POST',$physicalSettings));
 $assert((int)DB::table('v2_server_traffic_budget')->find($id)->network_server_id===$physical,'Legacy quota adopts explicit physical ownership');
 $assert(Budgets::forNode('v2node',$converted->id)['usedBytes']===55,'Integrated save preserves accumulated usage');
 $network->save(Request::create('/','POST',$physicalSettings));
 $assert(Budgets::forNode('v2node',$converted->id)['usedBytes']===55,'Repeated server save never repeats historical import');
 $bad=$physicalSettings;$bad['traffic']['nodes']=[];
 try{$network->save(Request::create('/','POST',$bad));throw new RuntimeException('Client binding injection accepted');}catch(Illuminate\Validation\ValidationException $e){$checks++;}
 $oldName=DB::table('v2_network_server')->find($physical)->name;
 $bad=$physicalSettings;$bad['traffic']['resetDay']=29;$bad['name']='Should not save';
 try{$network->save(Request::create('/','POST',$bad));throw new RuntimeException('Invalid integrated quota accepted');}catch(Illuminate\Validation\ValidationException $e){$checks++;}
 $assert(DB::table('v2_network_server')->find($physical)->name===$oldName,'Invalid quota does not partially save server metadata');
 try{$admin->save(Request::create('/','POST',array_merge($settings,['nodes'=>[]])));throw new RuntimeException('Physical bindings detached');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Legacy editor cannot override automatic membership');}
 $fresh=App\Models\ServerV2box::create(array_merge($base,['name'=>'Second service','up_mbps'=>0,'down_mbps'=>0]));
 DB::table('v2_stat_server')->insert(['server_id'=>$fresh->id,'server_type'=>'v2box','u'=>2,'d'=>3,'record_type'=>'d','record_at'=>$day,'created_at'=>time(),'updated_at'=>time()]);
 $assignment=DB::table('v2_node_ddns')->insertGetId(['credential_id'=>999999,'node_type'=>'v2box','node_id'=>$fresh->id,'domain'=>'fresh.example.test','family'=>'ipv4']);
 App\Services\NetworkServer::attach($assignment,$physical);
 $assert(Budgets::forNode('v2box',$fresh->id)['id']===$id && Budgets::forNode('v2box',$fresh->id)['usedBytes']===58,'Same-machine service automatically joins one quota with history imported once');
 App\Services\NetworkServer::attach($assignment,$physical);
 $assert(Budgets::forNode('v2box',$fresh->id)['usedBytes']===58,'Repeated attachment does not count history twice');
 $detail=$network->traffic(Request::create('/','GET',['id'=>$physical]))['data'];
 $assert(count($detail['nodes'])===3 && count($detail['history'])<=90 && $detail['budget']['usedBytes']===58,'Server detail contains bounded history and shared service usage');
 DB::enableQueryLog();DB::flushQueryLog();$admin->fetch(Request::create('/'));$queries=DB::getQueryLog();DB::disableQueryLog();
 $assert(count($queries)<=5,'Quota list uses a fixed number of batched queries');
 $before=DB::table('v2_server_traffic_budget')->count();
 $created=$network->save(Request::create('/','POST',['name'=>'Empty machine','family'=>'ipv4','enabled'=>true,'traffic'=>['limitBytes'=>0,'countingMode'=>'both','resetDay'=>1]]))['data']['id'];
 $assert(DB::table('v2_server_traffic_budget')->count()===$before+1 && DB::table('v2_server_traffic_budget')->where('network_server_id',$created)->value('limit_bytes')===0,'Server with no services can store unlimited quota');

 $elsewhere=DB::table('v2_network_server')->insertGetId(['name'=>'Other machine','family'=>'ipv4','enabled'=>true]);
 DB::table('v2_node_ddns')->where('id',$assignment)->update(['server_id'=>$elsewhere]);
 try{$network->save(Request::create('/','POST',['id'=>$elsewhere,'name'=>'Should roll back','family'=>'ipv4','enabled'=>true,'traffic'=>['limitBytes'=>10,'countingMode'=>'both','resetDay'=>1]]));throw new RuntimeException('Foreign server quota adopted');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===409,'Foreign server quota ownership is rejected');}
 $assert(DB::table('v2_network_server')->find($elsewhere)->name==='Other machine' && (int)DB::table('v2_server_traffic_budget')->find($id)->network_server_id===$physical,'Quota conflict rolls back metadata and preserves the original owner');
 DB::table('v2_node_ddns')->where('id',$assignment)->update(['server_id'=>$physical]);

 $migrationNode=App\Models\ServerV2box::create(array_merge($base,['name'=>'Legacy migration service','up_mbps'=>0,'down_mbps'=>0]));
 $oldBudgetResponse=$admin->save(Request::create('/','POST',['name'=>'Legacy account','limitBytes'=>4096,'countingMode'=>'both','resetDay'=>5,'nodes'=>[['type'=>'v2box','id'=>$migrationNode->id]]]));
 $oldBudget=json_decode($oldBudgetResponse->getContent(),true)['data']['id'];
 $oldServer=DB::table('v2_network_server')->insertGetId(['name'=>'Legacy machine','family'=>'ipv4','enabled'=>true]);
 DB::table('v2_node_ddns')->insert(['credential_id'=>999999,'node_type'=>'v2box','node_id'=>$migrationNode->id,'domain'=>'migration.example.test','family'=>'ipv4','server_id'=>$oldServer]);
 $legacyDetail=$network->traffic(Request::create('/','GET',['id'=>$oldServer]))['data'];
 $assert($legacyDetail['budget']['limitBytes']===4096 && DB::table('v2_server_traffic_budget')->find($oldBudget)->network_server_id===null,'Read-only details display explicit legacy quota without mutating ownership');
 $migration=require database_path('migrations/2026_10_24_000001_link_server_traffic_budget.php');$migration->up();$migration->up();
 $assert((int)DB::table('v2_server_traffic_budget')->find($oldBudget)->network_server_id===$oldServer && (int)DB::table('v2_server_traffic_budget')->find($oldBudget)->limit_bytes===4096,'Idempotent migration associates explicit legacy ownership without altering quota');
 echo "Server traffic budgets: {$checks} checks passed\n";
}finally{CarbonImmutable::setTestNow();DB::rollBack();}
