<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('local'))throw new RuntimeException('Local only');
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
 $r=Request::create('/api/v1/'.config('v2board.ops_api_path','ops').'/log/rule-hit/review','POST',['id'=>$hit->id,'state'=>'ignored']);$r->headers->set('Accept','application/json');
 if(app(Illuminate\Contracts\Http\Kernel::class)->handle($r)->getStatusCode()!==403)throw new RuntimeException('Unauthorized access');
 echo "PASS: review history, preserved evidence, grouped payload, validation and authorization\n";
}finally{DB::rollBack();}
