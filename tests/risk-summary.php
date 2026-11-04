<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;
use App\Models\RiskRuleHit;
use App\Services\RiskLogService;
use Illuminate\Http\Request;

$checks=0;
$assert=function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Check failed: '.($checks+1)); $checks++; };
$controller=new App\Http\Controllers\V1\Risk\LogController;
$originalZone = config('fastai.system_timezone');
DB::beginTransaction();
try {
    // All changes are rolled back; existing local fixture records are excluded temporarily.
    RiskRuleHit::query()->delete();
    foreach ([[time(), 'high',1], [time()-90000,'low',1], [time()-86400*40,'high',2]] as [$at,$level,$user]) {
        RiskRuleHit::create(['scene'=>'subscribe','rule_key'=>'subscribe_high_frequency_by_user_10m','risk_level'=>$level,'user_id'=>$user,'email'=>'risk-test@example.com','ip'=>'127.0.0.1','hit_at'=>$at]);
    }
    $data=json_decode($controller->getSummary(Request::create('/?window=today'))->getContent(), true)['data'];
    $assert($data['recent'][0]['email']==='risk-test@example.com' && $data['recent'][0]['user_id']===1);
    $assert($data['total']===1 && $data['high']===1 && $data['users']===1);
    $assert(array_sum(array_column($data['trend'],'hits'))===1);
    $assert($data['ranking'][0]['hits']===1 && count($data['recent'])===1);
    $data=json_decode($controller->getSummary(Request::create('/?window=7d'))->getContent(), true)['data'];
    $assert($data['total']===2 && $data['users']===1);
    $assert(!isset($data['traffic']) && !isset($data['income']));
    foreach (['blocked','block','deny','rejected','observed'] as $status) {
        RiskRuleHit::create(['scene'=>'subscribe','rule_key'=>'subscribe_high_frequency_by_user_10m','risk_level'=>'low','user_id'=>$status==='observed'?2:1,'status'=>$status,'hit_at'=>time()-60]);
    }
    $data=json_decode($controller->getSummary(Request::create('/?window=today'))->getContent(),true)['data'];
    $assert($data['total']===6 && $data['blocked']===4 && $data['users']===2);
    // Dashboard totals retain rolling windows, daily traffic selection and empty-UA handling.
    App\Models\SubscribeLog::query()->delete();
    App\Models\StatServer::query()->delete();
    $now=time();
    foreach([[-300,1,'mihomo','ClashMeta/1.19.0'],[-400,2,'mihomo',null],[-2*86400,1,'flclash','FlClash/0.8.0'],[-10*86400,3,'mihomo',''],[-40*86400,4,'old','Old/1.0']] as [$offset,$uid,$client,$ua]) {
        App\Models\SubscribeLog::create(['user_id'=>$uid,'client_type'=>$client,'user_agent'=>$ua,'status'=>'success','created_at'=>$now+$offset,'updated_at'=>$now+$offset]);
    }
    foreach([[0,100,200,'d'],[-2,500,600,'d'],[-10,1000,2000,'d'],[-40,9000,9000,'d'],[0,999,999,'m']] as $index=>[$days,$up,$down,$recordType]) {
        App\Models\StatServer::create(['server_id'=>$index+1,'server_type'=>'v2box','u'=>$up,'d'=>$down,'record_type'=>$recordType,'record_at'=>strtotime(date('Y-m-d',$now+$days*86400))]);
    }
    $overview=json_decode($controller->getOverview(Request::create('/'))->getContent(),true)['data'];
    foreach(['today'=>[2,2,100,200],'7d'=>[2,3,600,800],'30d'=>[3,4,1600,2800]] as $window=>[$users,$hits,$up,$down]) {
        $row=$overview['windows'][$window];
        $assert($row['active_users']===['users'=>$users,'hits'=>$hits]);
        $assert($row['traffic']===['up_bytes'=>$up,'down_bytes'=>$down,'total_bytes'=>$up+$down]);
        $assert($overview['metrics']['active_users'][$window]===$row['active_users'] && $overview['metrics']['traffic'][$window]===$row['traffic']);
    }
    $assert($overview['windows']['today']['risk_result']===['blocked_hits'=>4,'blocked_users'=>1,'pass_hits'=>2,'pass_users'=>1,'blocked_rate'=>'66.67%']);
    $ranking=collect($overview['flag_client_ranking'])->keyBy('client_type');
    $assert($ranking['mihomo']['hits_24h']===2 && $ranking['mihomo']['hits_30d']===3);
    $uaDetails=collect($overview['ua_raw_details_30d'])->keyBy('client_type');
    $assert(count($uaDetails['mihomo']['ua_rows'])===1 && $uaDetails['mihomo']['ua_rows'][0]['hits_24h']===1);

    // Dashboard data is independent of the legacy chart payload and raw grouped logs.
    RiskRuleHit::query()->delete();
    config(['fastai.system_timezone'=>'Asia/Kathmandu']);
    $boundary = (new DateTimeImmutable('2 days ago midnight', new DateTimeZone('Asia/Kathmandu')))->getTimestamp();
    $person = App\Models\User::create(['email'=>uniqid('risk-dash-').'@example.test','password'=>'test',
        'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
    $makeHit = fn (int $at, ?int $uid, ?string $state = null, string $risk = 'high', string $rule = 'subscribe_high_pull_low_traffic_24h')
        => RiskRuleHit::create(['scene'=>'subscribe','rule_key'=>$rule,'risk_level'=>$risk,'user_id'=>$uid,
            'payload'=>$state === null ? ['source_log_id'=>1] : ['review'=>['state'=>$state]],'hit_at'=>$at]);
    $pendingOld = $makeHit($now-40*86400, $person->id, 'pending');
    $pendingNew = $makeHit($now-5, $person->id);
    foreach (['confirmed','false_positive','ignored'] as $state) $makeHit($now-20, $person->id, $state);
    $makeHit($now-20, $person->id, null, 'low');
    $makeHit($now-20, $person->id, null, 'high', 'subscribe_ua_hash_blacklist_hit');
    $makeHit($now-20, null);
    $makeHit($now+3600, $person->id);
    foreach ([[$now-3, RiskLogService::IP_BLACKLIST_REASON, 'failed'], [$boundary-1, RiskLogService::UA_BLACKLIST_REASON, 'failed'],
        [$boundary, RiskLogService::IP_BLACKLIST_REASON, 'failed'], [$now-3, RiskLogService::UA_BLACKLIST_REASON, 'success'],
        [$now-3,'client_disabled','failed'], [$now+3600,RiskLogService::IP_BLACKLIST_REASON,'failed']] as [$at,$reason,$status]) {
        App\Models\SubscribeLog::create(['reason'=>$reason,'status'=>$status,'created_at'=>$at,'updated_at'=>$at]);
    }
    $dashboard = fn ($window) => json_decode($controller->getSummary(Request::create('/?view=dashboard&window='.$window))->getContent(), true)['data'];
    $dayReport = $dashboard('today');
    $weekReport = $dashboard('7d');
    $assert($dayReport['review_queue'] === ['total'=>2,'accounts'=>1,'oldest_at'=>$now-40*86400]
        && $dayReport['review_queue'] === $weekReport['review_queue']);
    $assert($dayReport['blacklist']['ip']===1 && $dayReport['blacklist']['ua']===0
        && $weekReport['blacklist']['ip']===2 && $weekReport['blacklist']['ua']===1);
    $buckets = collect($weekReport['blacklist']['trend'])->keyBy('at');
    $assert($buckets[$boundary]['ip']===1 && $buckets[$boundary]['ua']===0 && $buckets[$boundary-86400]['ua']===1);
    $assert($weekReport['rules'] === [['name'=>'高拉取低流量','hits'=>6,'accounts'=>1,'confirmed'=>1,'false_positives'=>1]]);
    $queue = fn ($page) => json_decode($controller->getRuleHits(Request::create('/?review_queue=1&page_size=1&current='.$page))->getContent(),true);
    $assert($queue(1)['total']===2 && $queue(1)['data'][0]['id']===$pendingOld->id && $queue(2)['data'][0]['id']===$pendingNew->id);
    $controller->reviewRuleHit(Request::create('/', 'POST', ['id'=>$pendingOld->id,'state'=>'confirmed']));
    $assert($dashboard('today')['review_queue']['total']===1 && $queue(1)['data'][0]['id']===$pendingNew->id);
    config(['fastai.system_timezone'=>$originalZone]);

    App\Models\RiskBlacklistIp::query()->delete();
    App\Models\RiskBlacklistUaHash::query()->delete();
    $ipResult=json_decode($controller->updateIpBlacklist(Request::create('/','POST',['value'=>'198.51.100.4','remark'=>'keep','is_enabled'=>true]))->getContent(),true)['data'];
    $uaResult=json_decode($controller->updateUaBlacklist(Request::create('/','POST',['ua_raw'=>'RiskFixture/1.0','is_enabled'=>false]))->getContent(),true)['data'];
    $assert(count($ipResult)===1 && count($uaResult)===2);
    $uaRows=json_decode($controller->getUaBlacklists(Request::create('/'))->getContent(),true)['data'];
    $assert(count($uaRows)===1 && $uaRows[0]['value']===hash('sha256','RiskFixture/1.0') && $uaRows[0]['is_enabled']===false);
    DB::enableQueryLog();DB::flushQueryLog();
    try {
        $ipRows=json_decode($controller->getIpBlacklists(Request::create('/'))->getContent(),true)['data'];
        $blacklistReads=count(array_filter(DB::getQueryLog(),fn($q)=>str_contains($q['query'],'v2_risk_blacklist_')));
    } finally {DB::disableQueryLog();}
    $assert(count($ipRows)===1 && $ipRows[0]['value']==='198.51.100.4' && $ipRows[0]['remark']==='keep');
    echo "Blacklist listing queries: $blacklistReads\n";
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
        $r=Request::create('/api/v1/'.config('fastai.ops_api_path','ops').'/'.$path, str_ends_with($path,'check') ? 'POST':'GET');
        $r->headers->set('Accept','application/json');
        $assert($kernel->handle($r)->getStatusCode()===403);
    }
    RiskRuleHit::query()->delete();
    App\Models\SubscribeLog::query()->delete();
    App\Models\StatServer::query()->delete();
    $data=json_decode($controller->getSummary(Request::create('/?window=today'))->getContent(),true)['data'];
    $assert($data['total']===0 && $data['blocked']===0 && $data['users']===0 && $data['ranking']===[] && $data['recent']===[] && array_sum(array_column($data['trend'],'hits'))===0);
    $empty=json_decode($controller->getOverview(Request::create('/'))->getContent(),true)['data'];
    foreach ($empty['windows'] as $window) {
        $assert($window['active_users']===['users'=>0,'hits'=>0] && $window['traffic']['total_bytes']===0 && $window['risk_result']['blocked_rate']==='0%');
    }
    $assert($empty['flag_client_ranking']===[] && $empty['ua_raw_details_30d']===[]);
    $assert($blacklistReads<=1);
} finally { DB::rollBack(); RiskLogService::clearRuleCache(); config(['fastai.system_timezone'=>$originalZone]); }
echo "PASS: {$checks} risk summary / validation / authorization checks\n";
