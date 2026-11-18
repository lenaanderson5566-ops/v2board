<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Http\Routes\V1\AdminRoute;
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
    App\Models\SubscribeLog::query()->delete();
    $now=time();
    foreach([[-300,1,'mihomo','ClashMeta/1.19.0'],[-400,2,'mihomo',null],[-2*86400,1,'flclash','FlClash/0.8.0'],[-10*86400,3,'mihomo',''],[-40*86400,4,'old','Old/1.0']] as [$offset,$uid,$client,$ua]) {
        App\Models\SubscribeLog::create(['user_id'=>$uid,'client_type'=>$client,'user_agent'=>$ua,'status'=>'success','created_at'=>$now+$offset,'updated_at'=>$now+$offset]);
    }
    $clientStats = app(App\Services\RiskStatisticsService::class)->clientSubscriptionStats([['client_type'=>'mihomo']])->first();
    $assert($clientStats['subscribe_flag_count_24h']===2 && $clientStats['subscribe_flag_count_30d']===3);
    $assert(count($clientStats['raw_ua_stats'])===1 && $clientStats['raw_ua_stats'][0]['count_24h']===1);

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
    $dashboard = fn ($window) => json_decode($controller->getSummary(Request::create('/?window='.$window))->getContent(), true)['data'];
    $dayReport = $dashboard('today');
    $weekReport = $dashboard('7d');
    $defaultReport = json_decode($controller->getSummary(Request::create('/'))->getContent(), true)['data'];
    $assert(array_keys($defaultReport) === ['review_queue', 'blacklist', 'rules']);
    $assert($defaultReport['review_queue'] === $dayReport['review_queue'] && $defaultReport['blacklist']['ip'] === $dayReport['blacklist']['ip']);
    $cacheClientReport = json_decode($controller->getSummary(Request::create('/?view=dashboard&window=7d'))->getContent(), true)['data'];
    $assert($cacheClientReport['review_queue'] === $weekReport['review_queue'] && $cacheClientReport['rules'] === $weekReport['rules']);
    try { $dashboard('90d'); $assert(false); }
    catch (Illuminate\Validation\ValidationException $e) { $assert(isset($e->errors()['window'])); }
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
    try { app(App\Services\LogRetentionService::class)->save(['connection_log_interval'=>'bad']); $assert(false); }
    catch (Illuminate\Validation\ValidationException $e) { $assert(true); }
    $kernel=app(Illuminate\Contracts\Http\Kernel::class);
    foreach (['risk/summary/fetch','client/releases/fetch','client/releases/check'] as $path) {
        $r=Request::create('/api/v1/'.AdminRoute::prefix().'/ops/'.$path, str_ends_with($path,'check') ? 'POST':'GET');
        $r->headers->set('Accept','application/json');
        $assert($kernel->handle($r)->getStatusCode()===403);
    }
    RiskRuleHit::query()->delete();
    App\Models\SubscribeLog::query()->delete();
    $empty=$dashboard('today');
    $assert($empty['review_queue']['total']===0 && $empty['rules']===[] && $empty['blacklist']['ip']===0 && $empty['blacklist']['ua']===0);
    $assert($blacklistReads<=1);
} finally { DB::rollBack(); RiskLogService::clearRuleCache(); config(['fastai.system_timezone'=>$originalZone]); }
echo "PASS: {$checks} risk summary / validation / authorization checks\n";
