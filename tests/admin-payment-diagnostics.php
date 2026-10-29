<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment, ClientStrategy};
use App\Services\{PaymentCallbackHistory, ClientStrategyService};
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$n = 0;
$assert = \Tests\Support\Assertions::counter($n);
set_exception_handler(function ($e) { fwrite(STDERR,$e->getMessage()."\n".$e->getTraceAsString()."\n"); exit(1); });
DB::beginTransaction();
try {
    $payment = Payment::create(['name'=>'Diagnostic test', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>['pid'=>'test', 'key'=>'test-secret']]);
    $order = Order::create(['user_id'=>1, 'plan_id'=>1, 'type'=>1, 'period'=>'month_price', 'trade_no'=>App\Utils\Helper::generateOrderNo(), 'total_amount'=>1000, 'status'=>0, 'payment_id'=>$payment->id]);
    $requestId = (string) Illuminate\Support\Str::uuid();
    PaymentCallbackHistory::record('PaytaroQR', $payment->uuid, null, 'verification', 'failed', 'verify error', $requestId);
    $history = PaymentCallbackHistory::forOrder($order);
    $assert(count($history['events']) === 0 && count($history['channelEvents']) === 1, 'Unverified callback cannot be attributed to an order');
    PaymentCallbackHistory::record('PaytaroQR', $payment->uuid, $order->trade_no, 'settlement', 'failed', 'secret=should-not-be-stored', $requestId);
    $history = PaymentCallbackHistory::forOrder($order);
    $assert($history['events'][0]->reason === 'internal_error', 'Raw errors are redacted');
    $assert($history['events'][0]->request_id === $requestId, 'Request ID can correlate logs');
    $other = Payment::create(['name'=>'Other channel', 'payment'=>'PaytaroQR', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>[]]);
    PaymentCallbackHistory::record('PaytaroQR', $other->uuid, $order->trade_no, 'settlement', 'failed', 'channel mismatch', null);
    $assert(count(PaymentCallbackHistory::forOrder($order)['events']) === 1, 'Unrelated channel does not contaminate order history');
    $request = Request::create('/', 'POST', ['merchant_no'=>$order->trade_no, 'callback_no'=>'fixture', 'status'=>'PAID', 'order_amount'=>1, 'order_currency'=>'CNY']);
    $request->headers->set('X-App-Secret', 'wrong');
    $app->instance('request', $request);
    try { (new App\Services\Actions\Guest\PaymentActions())->notify('PaytaroQR', $payment->uuid, $request); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode() === 500, 'Failed verification keeps provider failure response'); }
    $assert(count(PaymentCallbackHistory::forOrder($order)['events']) === 1, 'Forged order reference remains unassociated');
    $assert($order->fresh()->status === 0, 'Diagnostic recording does not settle an order');
    ClientStrategy::updateOrCreate(['client_type'=>'fastai'], ['client_name'=>'FastAI', 'is_enabled'=>1, 'min_version'=>'v1.3.0']);
    config(['v2board.fastai_releases'=>[['platform'=>'windows', 'architecture'=>'x64', 'minimumVersion'=>'1.2.0', 'latestVersion'=>'1.2.5']]]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $target = $row->effective_minimums[0];
    $assert($target['effectiveMinimum'] === '1.3.0' && !$target['latestAllowed'], 'Effective minimum uses normalized policy and warns when latest is blocked');
    ClientStrategy::where('client_type', 'fastai')->update(['min_version'=>null]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $assert($row->effective_minimums[0]['effectiveMinimum'] === '1.2.0', 'Release minimum applies without policy minimum');
    // Operations reports reuse persisted records; all destructive fixture setup is rolled back.
    config(['cache.default'=>'array','v2board.system_timezone'=>'Asia/Kathmandu']);
    $now=time();
    $from=(new DateTimeImmutable('tomorrow',new DateTimeZone('Asia/Kathmandu')))->modify('-7 days')->getTimestamp();
    foreach (['v2_login_log','v2_subscribe_log','v2_risk_rule_hit','v2_order','v2_payment_callback_event','v2_mail_log','v2_daily_task_run','v2_analytics_page','v2_analytics_session'] as $table) DB::table($table)->delete();
    foreach ([[1,'success',$now-1],[0,'password_error',$now-2],[0,'token=private@example.com',$now-3],[0,'another-secret',$now-4],[0,'password_error',$from-1],[0,'password_error',$now+3600]] as [$success,$reason,$at]) {
        DB::table('v2_login_log')->insert(['is_success'=>$success,'reason'=>$reason,'created_at'=>$at,'email'=>'private@example.com','ip'=>'192.0.2.1']);
    }
    foreach ([['success',null],['failed','expired'],['legacy','raw-secret']] as [$state,$reason]) DB::table('v2_subscribe_log')->insert(['user_id'=>1,'status'=>$state,'reason'=>$reason,'created_at'=>$now-1]);
    foreach (['confirmed','false_positive','ignored','pending',null] as $state) DB::table('v2_risk_rule_hit')->insert(['rule_key'=>'subscribe_high_frequency_by_user_10m','scene'=>'subscribe','user_id'=>$state===null ? null : 1,'payload'=>json_encode($state ? ['review'=>['state'=>$state,'note'=>'private-note']] : []),'hit_at'=>$now-10]);
    DB::table('v2_risk_rule_hit')->insert(['rule_key'=>'unknown','scene'=>'subscribe','payload'=>null,'hit_at'=>$now-1]);
    foreach ([['CNY',3,$now-100],['CNY',0,null],['USD',1,$now-100]] as [$currency,$state,$paid]) {
        DB::table('v2_order')->insert(['user_id'=>1,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>1000,'currency'=>$currency,'payment_id'=>$payment->id,'status'=>$state,'paid_at'=>$paid,'created_at'=>$now-200,'updated_at'=>$now]);
    }
    DB::table('v2_order')->insert(['user_id'=>1,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>0,'status'=>3,'paid_at'=>$now-50,'created_at'=>$now-150,'updated_at'=>$now]);
    foreach (['handled','handled','failed','acknowledged'] as $result) DB::table('v2_payment_callback_event')->insert(['payment_id'=>$payment->id,'provider'=>'PaytaroQR','stage'=>'settlement','result'=>$result,'created_at'=>$now-5]);
    foreach ([['accepted','delivered',$now-10,200],['failed','bounced',$now-10,400],['sending',null,$now-121,null],['sending',null,$now-10,null],[null,null,$now-10,null]] as [$state,$delivery,$at,$duration]) DB::table('v2_mail_log')->insert(['email'=>'private@example.com','subject'=>'code-secret','template_name'=>'verify','provider'=>'smtp','stream'=>'transactional','status'=>$state,'delivery_status'=>$delivery,'duration_ms'=>$duration,'created_at'=>$at,'updated_at'=>$now]);
    $zone=new DateTimeZone('Asia/Kathmandu');
    $today=(new DateTimeImmutable('@'.$now))->setTimezone($zone)->format('Y-m-d');
    DB::table('v2_daily_task_run')->insert(['task'=>'reset:traffic','business_date'=>$today,'timezone'=>'Asia/Kathmandu','status'=>'completed','updated_at'=>$now-20]);
    Illuminate\Support\Facades\Cache::put('LOG_RETENTION_LAST_RUN',['at'=>$now-30,'deleted'=>['secret'=>1]]);
    $health=Mockery::mock(App\Services\SystemHealthService::class);
    $health->shouldReceive('inspect')->andReturn(['checks'=>[['key'=>'scheduler','label'=>'定时任务','status'=>'healthy','message'=>'正常']]]);
    app()->instance(App\Services\SystemHealthService::class,$health);
    $work=Mockery::mock(Laravel\Horizon\Contracts\WorkloadRepository::class);
    $work->shouldReceive('get')->andReturn([['name'=>'order_handle','length'=>3,'wait'=>12,'processes'=>1,'payload'=>'secret']]);
    app()->instance(Laravel\Horizon\Contracts\WorkloadRepository::class,$work);
    $service=new App\Services\OperationsAnalytics();
    $report=$service->report(7);
    $assert($report['login']['total']===4 && $report['login']['successRate']===0.25,'Access report excludes past/future records and uses event denominator');
    $counts=array_column($report['login']['reasons'],'count','reason');
    $assert($counts===['other'=>2,'password_error'=>1],'Unknown sensitive reasons aggregate into one safe category');
    $assert($report['subscription']['total']===3 && $report['subscription']['unknown']===1 && $report['subscription']['successRate']===0.3333,'Unknown subscription states remain in the denominator');
    $rule=$report['risk']['rules'][0];
    $assert($rule['hits']===5 && $rule['users']===1 && $rule['pending']===2 && $rule['coverage']===0.6 && $rule['falsePositiveRate']===0.3333,'Risk reviews use actual nested review state and known-account deduplication');
    $assert($report['risk']['rules'][1]['falsePositiveRate']===null,'Unreviewed risk events have no false-positive rate');
    $cny=collect($report['payments']['channels'])->first(fn($r)=>$r['currency']==='CNY' && $r['channel']===$payment->name);
    $assert($cny['orders']===2 && $cny['paid']===1 && $cny['completed']===1 && $cny['paidRate']===0.5 && $cny['averagePaymentWaitSeconds']===100,'Channel cohort is based on orders, not repeated callbacks');
    $assert(count($report['payments']['channels'])===3 && $report['payments']['pendingActivation']===1,'Currency and balance orders stay separate; pending activation is a global snapshot');
    $callback=$report['payments']['callbacks'][0];
    $assert($callback['total']===4 && $callback['handled']===2 && $callback['failed']===1 && $callback['acknowledged']===1,'Callback outcomes preserve duplicates and non-settlement acknowledgements');
    $mail=$report['mail']['providers'][0];
    $assert($mail['total']===5 && $mail['accepted']===1 && $mail['failed']===1 && $mail['uncertain']===1 && $mail['other']===2 && $mail['acceptedRate']===0.2,'Stale sending mail is uncertain; legacy records remain explicit');
    $assert($mail['delivered']===1 && $mail['negative']===1 && $mail['averageTransportMs']===300,'Mail transport duration and delivery receipts are separate');
    $assert($report['health']['queues'][0]===['name'=>'order_handle','length'=>3,'waitSeconds'=>12,'processes'=>1],'Queue response uses a safe field whitelist');
    $assert($report['health']['lastPruneAt']===gmdate('c',$now-30) && $report['health']['dailyTasks'][0]['lastSuccessAt']===gmdate('c',$now-20),'Task snapshots expose persisted successful timestamps');
    $assert($report['login']['clients']['uniqueIps']===1 && $report['login']['clients']['topIps'][0]['maskedIp']==='192.0.2.***','Existing IPs are counted by scope and masked');
    $assert($report['subscription']['clients']['uniqueIps']===0 && $report['subscription']['clients']['unknownIpEvents']===3,'Missing IPs are not counted as visitors');
    $serialized=json_encode($report);
    foreach (['private@example.com','192.0.2.1','token=','another-secret','test-secret','private-note','code-secret'] as $secret) $assert(!str_contains($serialized,$secret),'Report does not expose '.$secret);
    $assert(App\Services\OperationsAnalytics::rate(0,0)===null,'Zero denominator is unavailable, not zero percent');
    // Non-integral-hour timezone and local midnight boundary coverage.
    $at=(new DateTimeImmutable('yesterday 00:05',$zone))->getTimestamp();
    DB::table('v2_analytics_session')->insert(['session_hash'=>str_repeat('a',64),'created_at'=>$at,'last_at'=>$at,'device'=>'desktop','language'=>'zh-CN','stage'=>3]);
    DB::table('v2_analytics_session')->insert(['session_hash'=>str_repeat('b',64),'created_at'=>$at-600,'last_at'=>$at-600,'device'=>'mobile','language'=>'zh-CN','stage'=>0]);
    $analytics=new App\Services\ProductAnalytics();
    $visits=$analytics->report(7,'all');
    $assert($visits['hours'][0]===1 && $visits['hours'][23]===1 && array_sum($visits['weekdays'])===2,'Hourly/weekday report respects quarter-hour timezone and midnight');
    $assert(array_sum($analytics->report(7,'desktop')['hours'])===1,'Access time distribution respects the device filter');
    $controller=new App\Http\Controllers\V1\Admin\ProductAnalyticsController();
    $response=$controller->operations(Request::create('/','GET',['days'=>7]),$service);
    $assert($response->getStatusCode()===200 && str_contains($response->headers->get('Cache-Control'),'no-store'),'Administrative response is private and non-storable');
    try { $controller->operations(Request::create('/','GET',['days'=>8]),$service); throw new RuntimeException('Invalid report range accepted'); }
    catch (Illuminate\Validation\ValidationException $e) { $assert(true,'Invalid report ranges rejected'); }
    $assert(DB::table('v2_login_log')->count()===6 && DB::table('v2_order')->count()===4,'Reports do not mutate source records');
    foreach (['2001:db8::1','2001:0db8:0:0:0:0:0:1','invalid'] as $ip) DB::table('v2_login_log')->insert(['is_success'=>0,'ip'=>$ip,'user_agent'=>'Mozilla/5.0 Chrome/123.0 MicroMessenger/8','created_at'=>$now-1]);
    $ipReport=$service->report(7)['login']['clients'];
    $assert($ipReport['uniqueIps']===2 && $ipReport['unknownIpEvents']===1,'IPv6 spelling canonicalization and invalid-IP exclusion');
    $assert(collect($ipReport['browsers'])->firstWhere('category','wechat')['total']===3,'Embedded browser takes precedence over Chrome signature');
    $assert(!str_contains(json_encode($ipReport),'2001:db8::1') && !str_contains(json_encode($ipReport),'MicroMessenger'),'Report exposes neither raw IP nor UA');
    DB::table('v2_login_log')->delete(); DB::table('v2_subscribe_log')->delete(); DB::table('v2_mail_log')->delete(); DB::table('v2_order')->delete();
    $empty=$service->report(7);
    $assert($empty['login']['successRate']===null && $empty['subscription']['successRate']===null && $empty['mail']['providers']===[] && $empty['payments']['channels']===[],'Empty reports do not fabricate success rates');
    $workFailure=Mockery::mock(Laravel\Horizon\Contracts\WorkloadRepository::class);
    $workFailure->shouldReceive('get')->andThrow(new RuntimeException('connection-secret'));
    app()->instance(Laravel\Horizon\Contracts\WorkloadRepository::class,$workFailure);
    $degraded=$service->report(7);
    $assert($degraded['health']['queues']===null && !str_contains(json_encode($degraded),'connection-secret'),'Queue failure is unavailable without leaking errors');
    // Second-batch cohorts and anonymous numeric observations share the same disposable fixture.
    foreach (['v2_analytics_measurement','v2_analytics_page','v2_analytics_session','v2_login_log','v2_subscribe_log','v2_stat_user','v2_order','v2_user'] as $table) DB::table($table)->delete();
    $today=new DateTimeImmutable('today',$zone);
    $makeUser=function($name,$age,$admin=0) use($today) {
        $at=$today->modify('-'.$age.' days')->getTimestamp()+3600;
        return App\Models\User::create(['email'=>$name.'@example.test','password'=>'fixture','token'=>App\Utils\Helper::guid(),'uuid'=>App\Utils\Helper::guid(true),'is_admin'=>$admin,'created_at'=>$at,'updated_at'=>$at,'plan_id'=>1]);
    };
    $a=$makeUser('journey-a',10);$b=$makeUser('journey-b',33);$c=$makeUser('journey-immature',2);$d=$makeUser('journey-inactive',10);$administrator=$makeUser('journey-admin',10,1);
    $d->expired_at=$today->modify('-8 days')->getTimestamp();$d->save();
    $makeOrder=function($user,$at,$type=1,$period='month_price',$amount=1000) {
        return Order::create(['user_id'=>$user->id,'plan_id'=>1,'type'=>$type,'period'=>$period,'trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>$amount,'status'=>3,'paid_at'=>$at,'created_at'=>$at-10,'updated_at'=>$at]);
    };
    foreach ([$a,$b,$c,$administrator] as $u) {
        $paidAt=(int)$u->getRawOriginal('created_at')+3600;
        $makeOrder($u,$paidAt);
        DB::table('v2_subscribe_log')->insert(['user_id'=>$u->id,'status'=>'success','created_at'=>$paidAt+600]);
    }
    $makeOrder($b,(int)$b->getRawOriginal('created_at')+10*86400,2);
    $makeOrder($d,(int)$d->getRawOriginal('created_at')+100,1,'reset_price');
    foreach ([$a,$b,$administrator] as $u) {
        $recordAt=$today->modify('-4 days')->getTimestamp();
        foreach ([1,2] as $rate) DB::table('v2_stat_user')->insert(['user_id'=>$u->id,'server_rate'=>$rate,'u'=>1,'d'=>1,'record_type'=>'d','record_timezone'=>'Asia/Kathmandu','record_at'=>$recordAt,'created_at'=>$recordAt+3600,'updated_at'=>$recordAt+3600]);
        foreach ([0,1] as $duplicate) DB::table('v2_login_log')->insert(['user_id'=>$u->id,'is_success'=>1,'created_at'=>$recordAt+3600+$duplicate]);
    }
    $journey=(new App\Services\JourneyAnalytics())->report(7);
    $activation=$journey['activation'];
    $assert($activation['registered']===2 && $activation['paid']===1 && $activation['subscribed']===1 && $activation['used']===1,'Activation excludes immature/admin accounts and non-plan reset orders');
    $assert($activation['averagePaymentSeconds']===3600 && $activation['averageSubscriptionSeconds']===600,'Exact paid/subscribe latency uses authoritative ordered timestamps');
    $assert($journey['retentionCohorts'][0]['registered']===2 && $journey['retentionCohorts'][0]['login']===1 && $journey['retentionCohorts'][0]['usage']===1 && $journey['retentionCohorts'][0]['usageRate']===0.5,'D7 retention deduplicates repeated logins and traffic-rate buckets');
    $assert($journey['retentionCohorts'][1]['registered']===1 && $journey['retentionCohorts'][1]['loginRate']===1.0,'D30 uses its own fully observed registration cohort');
    $assert($journey['repurchase']['eligible']===1 && $journey['repurchase']['renewed']===1 && $journey['repurchase']['rate']===1.0,'Repurchase cohort requires first positive payment and a later type-2 payment');
    $assert($journey['expiredUnrestored']===1 && $journey['active'][1]['login']===2 && $journey['active'][1]['usage']===2,'Expiry is a current mature snapshot; active counts exclude administrators');
    $assert(!str_contains(json_encode($journey),'journey-a@example.test'),'Journey reports expose no account identifiers');
    $analytics->save(['enabled'=>true,'retentionDays'=>7]);
    $event=['sessionId'=>(string)Illuminate\Support\Str::uuid(),'page'=>'plan','device'=>'desktop','language'=>'zh-CN','consent'=>true];
    $analytics->record($event, 'Mozilla/5.0 (Linux; Android 14) Chrome/123.0 MicroMessenger/8');
    foreach ([100,200,500,10000] as $value) $analytics->record($event+['event'=>'lcp','value'=>$value]);
    $analytics->record(array_replace($event,['page'=>'payment','event'=>'import_start']));
    $measurement=new App\Services\ExperienceMeasurements();
    $measured=$measurement->report(7,'desktop');
    $lcp=collect($measured['rows'])->firstWhere('event','lcp');
    $repeatMigration=require database_path('migrations/2026_10_19_000001_create_analytics_measurements.php');
    $repeatMigration->up();
    $assert(DB::table('v2_analytics_measurement')->sum('samples')==5,'Measurement migration is idempotent and preserves existing observations');
    $assert($lcp['samples']===4 && $lcp['sessions']===1 && $lcp['average']===2700.0 && $lcp['p75Upper']===500 && $lcp['p95Upper']===10000,'Numeric histograms retain exact sums and expose estimated percentile bucket bounds');
    $session=DB::table('v2_analytics_session')->first();
    $assert($session->browser==='chrome' && $session->browser_major===123 && $session->embedded==='wechat' && $session->os==='android','Only coarse browser categories persist on first event');
    $browserRows=$analytics->report(7,'all')['browsers'];
    $assert($browserRows[0]['sessions']===1 && $browserRows[0]['browser']==='chrome','Browser aggregate uses session cohort');
    $repeatBrowserMigration=require database_path('migrations/2026_10_19_000003_add_analytics_browsers.php');
    $repeatBrowserMigration->up();
    $assert(DB::table('v2_analytics_session')->first()->browser==='chrome','Repeat browser migration preserves observations');
    $assert(DB::table('v2_analytics_page')->sum('views')==1 && $session->stage===1,'Action and numeric events never inflate page views or purchase funnel stages');
    $assert($measurement->report(7,'mobile')['rows']===[],'Experience reports respect anonymous device filtering');
    $analytics->record(array_replace($event,['page'=>'payment','event'=>'payment_open']));
    $opened=collect($measurement->report(7,'desktop')['rows'])->firstWhere('event','payment_open');
    $assert($opened && $opened['page']==='payment' && $opened['samples']===1 && $opened['sessions']===1 && $opened['average']===null,'Payment open records a bounded named click, without a metric value');
    $assert(DB::table('v2_analytics_page')->sum('views')==1 && DB::table('v2_analytics_session')->first()->stage===1,'Opening a provider does not manufacture a page view or successful payment funnel stage');

    DB::table('v2_analytics_measurement')->where('event','lcp')->where('bucket',100)->update(['samples'=>195]);
    $before=DB::table('v2_analytics_measurement')->sum('samples');
    $analytics->record($event+['event'=>'js_error']);
    $assert((int)$before===200 && (int)DB::table('v2_analytics_measurement')->sum('samples')===200,'Session lock and sample budget bound observation storage');
    $public=new App\Http\Controllers\V10\ProductAnalyticsController();
    $invoke=function(array $extra,array $headers=[])use($event,$public,$analytics,$app){
        $r=Request::create('http://localhost/api/v10/public/analytics/events','POST',[],[],[],array_merge(['HTTP_ORIGIN'=>'http://localhost','CONTENT_TYPE'=>'application/json'],$headers),json_encode(array_replace($event,$extra)));
        $app->instance('request',$r);return $public->store($r,$analytics);
    };
    foreach ([['event'=>'lcp'],['event'=>'copy_success','value'=>1],['event'=>'cls','value'=>100001],['event'=>'js_error','message'=>'private-secret'],['event'=>'api_request','value'=>-1],['event'=>'payment_open','value'=>1],['event'=>'payment_open','orderNumber'=>'private-order']] as $bad) {
        try {$invoke($bad);throw new RuntimeException('Invalid numeric/action observation accepted');}
        catch (Illuminate\Validation\ValidationException $e) {$assert(true,'Invalid observation validation rejected');}
        catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {$assert($e->getStatusCode()===422,'Invalid observation contract rejected');}
    }
    $assert($invoke(['page'=>'payment','event'=>'payment_open'])->getStatusCode()===204,'The public contract accepts a payment click without a value or transaction fields');
    $assert($invoke(['event'=>'lcp','value'=>100],['HTTP_SEC_GPC'=>'1'])->getStatusCode()===204 && (int)DB::table('v2_analytics_measurement')->sum('samples')===200,'GPC prevents optional metric storage');
    DB::table('v2_analytics_session')->where('id',$session->id)->update(['created_at'=>$now-8*86400]);
    $analytics->prune();
    $assert(DB::table('v2_analytics_measurement')->count()===0,'Existing privacy retention removes measurement buckets with sessions');
    $analytics->save(['enabled'=>false,'retentionDays'=>7]);
    echo "PASS {$n} admin payment/version/operations/journey checks\n";
} finally { DB::rollBack(); }
