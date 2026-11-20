<?php
$app = require __DIR__.'/support/bootstrap.php';
if(!app()->environment('local'))throw new RuntimeException('Local only');
use App\Http\Routes\V1\AdminRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
use App\Models\RiskRuleHit;
DB::beginTransaction();
try{
 $hit=RiskRuleHit::create(['scene'=>'login','rule_key'=>'review_test','risk_level'=>'low','hit_at'=>time(),'payload'=>['threshold'=>5,'failed_count'=>6]]);
 $controller=new App\Http\Controllers\V1\Risk\LogController;
 foreach(['false_positive','confirmed'] as $state){$r=Request::create('/','POST',['id'=>$hit->id,'state'=>$state,'note'=>'Test note','user'=>['id'=>123]]);$controller->reviewRuleHit($r);}
 $payload=$hit->fresh()->payload;
 if($payload['threshold']!==5 || $payload['review']['state']!=='confirmed' || count($payload['review_history'])!==2 || $payload['review']['admin_id']!==123)throw new RuntimeException('Review evidence/audit lost');
 $r=Request::create('/','GET',['grouped'=>1,'rule_key'=>'review_test']);
 $data=json_decode($controller->getRuleHits($r)->getContent(),true)['data'];
 if($data[0]['payload']['failed_count']!==6)throw new RuntimeException('Grouped evidence missing');
 try{$controller->reviewRuleHit(Request::create('/','POST',['id'=>$hit->id,'state'=>'blocked']));throw new RuntimeException('Invalid state accepted');}catch(Illuminate\Validation\ValidationException $e){}
 $r=Request::create('/api/v1/'.AdminRoute::prefix().'/ops/log/rule-hit/review','POST',['id'=>$hit->id,'state'=>'ignored']);$r->headers->set('Accept','application/json');
 if(app(Illuminate\Contracts\Http\Kernel::class)->handle($r)->getStatusCode()!==403)throw new RuntimeException('Unauthorized access');
 $create = fn ($at, $payload) => RiskRuleHit::create(['scene'=>'login','rule_key'=>'batch_review_test',
     'risk_level'=>'low','hit_at'=>$at,'payload'=>$payload]);
 $old = time() - 40 * 86400;
 $unselected = $create(time(), []);
 $first = $create($old, ['threshold'=>3]);
 $second = $create($old, ['review'=>['state'=>'pending']]);
 $queue = fn ($params = []) => json_decode($controller->getRuleHits(Request::create('/', 'GET', $params + [
     'review_state'=>'pending', 'grouped'=>1, 'rule_key'=>'batch_review_test'
 ]))->getContent(), true);
 $page = $queue(['page_size'=>2]);
 if ($page['total'] !== 3 || array_column($page['data'], 'id') !== [$first->id,$second->id]
     || $queue(['from'=>$old+1])['total'] !== 1) throw new RuntimeException('Raw review queue lost old, filtered or tied hits');

 $bulk = fn ($params) => json_decode($controller->reviewRuleHit(Request::create('/', 'POST',
     $params + ['state'=>'ignored', 'note'=>'Reviewed together', 'user'=>['id'=>321]]))->getContent(), true)['data'];
 $selection = ['ids'=>[$second->id,$hit->id,$first->id,2147483647]];
 foreach ([['ids'=>[]], ['ids'=>[0]], ['ids'=>range(1,101)], ['ids'=>[$first->id,$first->id]],
           ['ids'=>[$first->id], 'id'=>$first->id], ['ids'=>[$first->id], 'state'=>'pending']] as $invalid) {
     try { $bulk($invalid); throw new RuntimeException('Invalid batch accepted'); }
     catch (Illuminate\Validation\ValidationException $e) {}
 }
 if ($bulk($selection) !== ['updated'=>2,'skipped'=>2] || $bulk($selection) !== ['updated'=>0,'skipped'=>4]) {
     throw new RuntimeException('Batch counts or retry behavior incorrect');
 }
 foreach ([$first,$second] as $selected) {
     $audit = $selected->fresh()->payload;
     if (count($audit['review_history']) !== 1 || $audit['review'] !== $audit['review_history'][0]
         || $audit['review']['state'] !== 'ignored' || $audit['review']['note'] !== 'Reviewed together'
         || $audit['review']['admin_id'] !== 321 || $audit['review']['at'] < $old) throw new RuntimeException('Batch audit missing');
 }
 if ($first->fresh()->payload['threshold'] !== 3 || $hit->fresh()->payload !== $payload
     || array_column($queue()['data'], 'id') !== [$unselected->id]
     || $queue(['review_state'=>'ignored'])['total'] !== 2) throw new RuntimeException('Batch scope or evidence changed');

 $another = $create($old, []);
 RiskRuleHit::saving(function (RiskRuleHit $event) use ($another) {
     if ($event->id === $another->id) throw new LogicException('Simulated write failure');
 });
 try { $bulk(['ids'=>[$unselected->id,$another->id]]); throw new RuntimeException('Batch write failure ignored'); }
 catch (LogicException $e) { if ($e->getMessage() !== 'Simulated write failure') throw $e; }
 if ($unselected->fresh()->payload !== [] || $another->fresh()->payload !== []) throw new RuntimeException('Partial batch committed');
 echo "PASS: review history, authorization, pending queue, batch scope, retries and rollback\n";
}finally{DB::rollBack();}
