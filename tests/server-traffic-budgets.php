<?php
require __DIR__.'/../vendor/autoload.php';$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
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
$checks=0;$assert=function($ok,$message)use(&$checks){if(!$ok)throw new RuntimeException($message);$checks++;};
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
 echo "Server traffic budgets: {$checks} checks passed\n";
}finally{CarbonImmutable::setTestNow();DB::rollBack();}
