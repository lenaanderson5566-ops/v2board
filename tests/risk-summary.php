<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\RiskRuleHit;
use App\Services\RiskLogService;
use Illuminate\Http\Request;

$checks=0;
$assert=function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Check failed: '.($checks+1)); $checks++; };
$controller=new App\Http\Controllers\V1\Risk\LogController;
DB::beginTransaction();
try {
    // All changes are rolled back; existing local fixture records are excluded temporarily.
    RiskRuleHit::query()->delete();
    foreach ([[time(), 'high',1], [time()-90000,'low',1], [time()-86400*40,'high',2]] as [$at,$level,$user]) {
        RiskRuleHit::create(['scene'=>'subscribe','rule_key'=>'subscribe_high_frequency_by_user_10m','risk_level'=>$level,'user_id'=>$user,'ip'=>'127.0.0.1','hit_at'=>$at]);
    }
    $data=json_decode($controller->getSummary(Request::create('/?window=today'))->getContent(), true)['data'];
    $assert($data['total']===1 && $data['high']===1 && $data['users']===1);
    $assert(array_sum(array_column($data['trend'],'hits'))===1);
    $assert($data['ranking'][0]['hits']===1 && count($data['recent'])===1);
    $data=json_decode($controller->getSummary(Request::create('/?window=7d'))->getContent(), true)['data'];
    $assert($data['total']===2 && $data['users']===1);
    $assert(!isset($data['traffic']) && !isset($data['income']));
    $rule='subscribe_high_frequency_by_user_10m';
    $controller->updateRule(Request::create('/', 'POST', ['rule_key'=>$rule, 'thresholds'=>['threshold'=>33,'window_seconds'=>600]]));
    $rules=collect((new RiskLogService)->getRuleDefinitions())->keyBy('rule_key');
    $assert($rules[$rule]['thresholds']['threshold']===33);
    $assert($rules[$rule]['default_thresholds']['threshold']===20);
    foreach ([['threshold'=>0], ['window_seconds'=>0], ['window_seconds'=>2592001], ['threshold'=>1.1], ['unknown'=>2]] as $thresholds) {
        try { $controller->updateRule(Request::create('/', 'POST', ['rule_key'=>$rule, 'thresholds'=>$thresholds])); $assert(false); }
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422); }
    }
    try { $controller->updateRiskSettings(Request::create('/', 'POST', ['connection_log_interval'=>'bad'])); $assert(false); }
    catch (Illuminate\Validation\ValidationException $e) { $assert(true); }
    $kernel=app(Illuminate\Contracts\Http\Kernel::class);
    foreach (['risk/summary/fetch','client/releases/fetch','client/releases/check'] as $path) {
        $r=Request::create('/api/v1/'.config('v2board.ops_api_path','ops').'/'.$path, str_ends_with($path,'check') ? 'POST':'GET');
        $r->headers->set('Accept','application/json');
        $assert($kernel->handle($r)->getStatusCode()===403);
    }
} finally { DB::rollBack(); RiskLogService::clearRuleCache(); }
echo "PASS: {$checks} risk summary / validation / authorization checks\n";
