<?php
$app = require __DIR__.'/support/bootstrap.php';
if(!app()->environment('local'))throw new RuntimeException('Local only');
use App\Http\Routes\V1\AdminRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
use App\Models\RiskRuleHit;
use App\Services\RiskLogService;
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
 // One-off cleanup uses its own snapshot and never updates the scheduled retention settings.
 config(['cache.default'=>'array','fastai.system_timezone'=>'Asia/Kathmandu']);
 RiskRuleHit::query()->delete();
 $cleanup = app(App\Services\RiskHitCleanup::class);
 $preview = fn ($params, $actor = 123) => json_decode($controller->previewRuleHitCleanup(Request::create('/', 'POST',
     $params + ['user'=>['id'=>$actor]]), $cleanup)->getContent(), true)['data'];
 $execute = function ($token, $actor = 123) use ($controller, $cleanup) {
     $response = $controller->executeRuleHitCleanup(Request::create('/', 'POST', ['token'=>$token,'user'=>['id'=>$actor]]), $cleanup);
     $data = json_decode($response->getContent(), true)['data'];
     $expected = in_array($data['state'], ['queued','running'], true) ? 202 : 200;
     if ($response->getStatusCode() !== $expected) throw new RuntimeException('Unexpected confirmation status');
     return $data;
 };
 $finish = function ($token) use ($execute, $cleanup) {
     $task = $execute($token);
     if ($task['state'] !== 'queued' || $task['deleted'] !== 0) throw new RuntimeException('Confirmation did not queue a task');
     while ($cleanup->processBatch($task['id'])) {}
     $status = $cleanup->status(123, $task['id']);
     if ($status['state'] !== 'completed' || $status['matched'] !== $status['deleted'] + $status['skipped']) throw new RuntimeException('Bad task progress');
     return ['deleted'=>$status['deleted'], 'skipped'=>$status['skipped']];
 };
 $rejectToken = function ($token, $actor = 123) use ($execute) {
     try { $execute($token, $actor); throw new RuntimeException('Invalid preview was consumed'); }
     catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
         if ($error->getStatusCode() !== 409) throw $error;
     }
 };
 $done = ['review'=>['state'=>'confirmed']];
 $plain = $create(100, $done);
 $edited = $create(101, $done);
 $missing = $create(102, $done);
 $pending = $create(103, []);
 $boundary = $create(104, $done);
 $filter = ['before'=>104];
 $snapshot = $preview($filter);
 if ($snapshot['matched']!==3 || $snapshot['reviewed']!==3 || $snapshot['pending']!==0 ||
     $snapshot['limit']!==1000 || !is_string($snapshot['token'])) throw new RuntimeException('Default preview scope incorrect');
 if (array_column($snapshot['rows'], 'id') !== [$plain->id,$edited->id,$missing->id]
     || $snapshot['excluded_pending'] !== null || $snapshot['rows'][0] !== [
         'id'=>$plain->id, 'hit_at'=>100, 'rule_name'=>RiskLogService::ruleName($plain->rule_key),
         'review_state'=>'confirmed', 'risk_level'=>'low'
     ]) throw new RuntimeException('Preview rows differ from the eligible batch or expose extra fields');
 $rejectToken($snapshot['token'], 124);
 $new = $create(99, $done);
 DB::table('v2_risk_rule_hit')->where('id',$edited->id)->update(['payload'=>json_encode(
     $done + ['review_history'=>[['state'=>'confirmed','note'=>'reviewed again']]]
 )]);
 $missing->delete();
 if ($finish($snapshot['token'])!==['deleted'=>1,'skipped'=>2] || $plain->fresh() ||
     !$edited->fresh() || !$new->fresh() || !$pending->fresh() || !$boundary->fresh()) {
     throw new RuntimeException('Execution expanded beyond its unchanged preview');
 }
 if ($execute($snapshot['token']) !== $cleanup->status(123) || $cleanup->status(124) !== null) throw new RuntimeException('Confirmation replay or cross-admin lookup changed task');
 $firstToken = $preview($filter)['token'];
 $mixed = $preview($filter + ['include_pending'=>true]);
 $rejectToken($firstToken);
 if ($mixed['matched']!==3 || $mixed['reviewed']!==2 || $mixed['pending']!==1) throw new RuntimeException('Mixed counts incorrect');
 app(RiskLogService::class)->reviewHit(['id'=>$pending->id,'state'=>'ignored'], 321);
 if ($finish($mixed['token'])!==['deleted'=>2,'skipped'=>1] || !$pending->fresh()) throw new RuntimeException('Concurrent review lost');
 $included = $create(102, ['review'=>['state'=>'pending']]);
 $token = $preview($filter + ['include_pending'=>true])['token'];
 if ($finish($token)!==['deleted'=>2,'skipped'=>0] || $included->fresh()) throw new RuntimeException('Explicit pending cleanup failed');
 $empty = $preview($filter);
 if ($empty['matched']!==0 || $empty['token']!==null || $empty['expires_at']!==null
     || $empty['rows']!==[] || $empty['excluded_pending']!==0) throw new RuntimeException('Empty cleanup was actionable');
 $legacy = $create(100, []);
 $otherPending = $create(103, ['review'=>['state'=>'pending']]);
 $filtered = $preview($filter);
 if ($filtered['matched']!==0 || $filtered['rows']!==[] || $filtered['token']!==null
     || $filtered['excluded_pending']!==2) throw new RuntimeException('Missing pending-only empty-state explanation');
 $includedPreview = $preview($filter + ['include_pending'=>true]);
 if (array_column($includedPreview['rows'],'id')!==[$legacy->id,$otherPending->id]
     || array_column($includedPreview['rows'],'review_state')!==['pending','pending']
     || $includedPreview['excluded_pending']!==null) throw new RuntimeException('Included pending hits missing from preview');
 $retention = app(App\Services\LogRetentionService::class)->settings();
 $cutoff = now('Asia/Kathmandu')->addDay()->startOfDay()->timestamp;
 $future = $create(now()->timestamp+60, $done);
 $today = $preview(['before'=>$cutoff]);
 if ($today['matched']!==1 || !$future->fresh()) throw new RuntimeException('Today selected a future hit');
 try { $preview(['before'=>$cutoff+1]); throw new RuntimeException('Future date accepted'); }
 catch (Illuminate\Validation\ValidationException $e) {}
 Illuminate\Support\Carbon::setTestNow(now()->addMinutes(11));
 try { $rejectToken($today['token']); } finally { Illuminate\Support\Carbon::setTestNow(); }
 $bulkFixture = ['scene'=>'login','rule_key'=>'cleanup_limit','risk_level'=>'low','hit_at'=>10,
     'payload'=>json_encode($done),'created_at'=>10,'updated_at'=>10];
 foreach (array_chunk(array_fill(0, 2001, $bulkFixture), 100) as $chunk) DB::table('v2_risk_rule_hit')->insert($chunk);
 $limited = $preview(['before'=>20]);
 $task = $execute($limited['token']);
 if ($limited['matched']!==2001 || $limited['reviewed']!==2001 || $limited['pending']!==0 || count($limited['rows'])!==1000 ||
     $task['matched']!==2001 || !$cleanup->processBatch($task['id'])) throw new RuntimeException('Full cleanup stopped at the sample limit');
 $progress = $cleanup->status(123, $task['id']);
 if ($progress['deleted']!==1000 || $progress['state']!=='running') throw new RuntimeException('Batch did not checkpoint progress');
 $late = $create(9, $done);
 $cleanup->markFailed($task['id']);
 if ($cleanup->processBatch($task['id']) || $cleanup->status(123)['state']!=='failed') throw new RuntimeException('Task failure lost');
 $create(1, $done);
 $newer = $preview(['before'=>2]);
 if ($finish($newer['token'])!==['deleted'=>1,'skipped'=>0] || $cleanup->status(123)['id']!==$task['id']) {
     throw new RuntimeException('A newer completion hid a recoverable task');
 }
 try { $cleanup->retry(124, $task['id']); throw new RuntimeException('Cross-admin retry allowed'); }
 catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { if ($e->getStatusCode() !== 404) throw $e; }
 $retry = $controller->retryRuleHitCleanup(Request::create('/', 'POST', ['id'=>$task['id'],'user'=>['id'=>123]]), $cleanup);
 if ($retry->getStatusCode()!==202 || json_decode($retry->getContent(), true)['data']['state']!=='queued'
     || Illuminate\Support\Facades\Artisan::call('risk:process-cleanups')!==0
     || $cleanup->status(123, $task['id'])['deleted']!==2001 || $cleanup->status(123, $task['id'])['state']!=='completed'
     || !$late->fresh() || $preview(['before'=>20])['matched']!==1
     || app(App\Services\LogRetentionService::class)->settings()!==$retention) throw new RuntimeException('Resume changed the snapshot or retention');
 if (RiskRuleHit::query()->whereIntegerInRaw('id',array_column($limited['rows'],'id'))->exists()) throw new RuntimeException('Cleanup did not consume the displayed snapshot');
 foreach (['preview'=>'POST','execute'=>'POST','status'=>'GET','retry'=>'POST'] as $action=>$method) {
     $req = Request::create('/api/v1/'.AdminRoute::prefix().'/ops/log/rule-hit/cleanup/'.$action,$method);
     $req->headers->set('Accept','application/json');
     if (app(Illuminate\Contracts\Http\Kernel::class)->handle($req)->getStatusCode()!==403) throw new RuntimeException('Unauthorized cleanup');
 }
 echo "PASS: review history, scoped full cleanup, pending counts and sample, changed rows, authorization and multi-batch scheduled recovery\n";
}finally{DB::rollBack();}
