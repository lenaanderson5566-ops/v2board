<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\{Order, Payment, ClientStrategy};
use App\Services\{PaymentAttemptHistory, PaymentCallbackHistory, ClientStrategyService};
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
    $payment->update(['payment' => 'MGate']);
    $attempt = new PaymentAttemptHistory($requestId);
    $attempt->identify($order, $payment->id);
    $attempt->sending('https://gateway.example/v1/gateway/fetch');
    $mgateResponse = (object) ['code' => 1, 'message' => 'Unrecognized error fixture-private-message', 'data' => (object) [
        'pay_url' => 'javascript:fixture-private-url', 'checkoutUrl' => 'https://gateway.example/pay?secret=fixture-private-link',
        'tradeNo' => 'fixture-private-order', 'appSecret' => 'fixture-private-secret', 'fixture-private-key' => 'untrusted',
    ]];
    $attempt->received((object) ['httpStatusCode' => 200, 'response' => $mgateResponse], 1, null, $mgateResponse->data, 'MGate');
    $attempt->checkpoint('missing_payment_action');
    $attempt->finish('failed');
    $summary = PaymentAttemptHistory::forOrder($order)['events'][0]->gateway_response;
    $assert($summary['fields']['data.trade_no'] === 'missing' && $summary['fields']['data.pay_url'] === 'invalid_url'
        && $summary['fields']['data.tradeNo'] === 'string' && $summary['fields']['data.checkoutUrl'] === 'masked' && $summary['codes']['code'] === 1,
        'MGate diagnostics identify missing fields and unexpected payment URL locations');
    $assert($summary['other_fields']['data'] === 1 && $summary['fields']['data.appSecret'] === 'masked' && $summary['unrecognized_message']
        && !str_contains(json_encode($summary), 'fixture-private'), 'Stored diagnostics contain no raw field names, secrets, URLs or unknown messages');
    $assert(PaymentAttemptHistory::forChannel($payment->id)['events'][0]->gateway_response === $summary,
        'Same redacted summary is available in channel failure diagnostics');

    $epayResponse = '{"msg":"Stats pid is null: fixture-private-pid","sign":"fixture-private-sign","payurl":""}';
    $epay = Payment::create(['name'=>'Diagnostic EPay', 'payment'=>'EPayQrcode', 'uuid'=>App\Utils\Helper::guid(), 'enable'=>1, 'config'=>[]]);
    $attempt = new PaymentAttemptHistory($requestId);
    $attempt->identify($order, $epay->id);
    $attempt->sending('https://gateway.example/mapi.php');
    $attempt->received((object) ['httpStatusCode' => 200, 'response' => $epayResponse], null, null, json_decode($epayResponse), 'EPayQrcode');
    $attempt->finish('failed');
    $summary = PaymentAttemptHistory::forChannel($epay->id)['events'][0]->gateway_response;
    $assert($summary['format'] === 'object' && $summary['fields']['code'] === 'missing'
        && $summary['fields']['payurl'] === 'empty' && $summary['fields']['sign'] === 'masked'
        && $summary['messages'] === ['商户 PID 缺失'] && !str_contains(json_encode($summary), 'fixture-private'),
        'EPay diagnostics recognize a JSON string with no code and map the error to a safe label');
    $markup = App\Services\PaymentGatewayResponse::summarize('<html>fixture-private-html</html>', 'EPayQrcode');
    $assert($markup['format'] === 'markup' && $markup['fields']['code'] === 'missing' && !str_contains(json_encode($markup), 'fixture-private'),
        'HTML responses are identifiable without retaining their contents');
    $payment->update(['payment' => 'PaytaroQR']);
    ClientStrategy::updateOrCreate(['client_type'=>'fastai'], ['client_name'=>'FastAI', 'is_enabled'=>1, 'min_version'=>'v1.3.0']);
    config(['fastai.fastai_releases'=>[['platform'=>'windows', 'architecture'=>'x64', 'minimumVersion'=>'1.2.0', 'latestVersion'=>'1.2.5']]]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $target = $row->effective_minimums[0];
    $assert($target['effectiveMinimum'] === '1.3.0' && !$target['latestAllowed'], 'Effective minimum uses normalized policy and warns when latest is blocked');
    ClientStrategy::where('client_type', 'fastai')->update(['min_version'=>null]);
    $row = (new ClientStrategyService())->getStrategies()->firstWhere('client_type', 'fastai');
    $assert($row->effective_minimums[0]['effectiveMinimum'] === '1.2.0', 'Release minimum applies without policy minimum');
    // Operations reports reuse persisted records; all destructive fixture setup is rolled back.
    config(['cache.default'=>'array','fastai.system_timezone'=>'Asia/Kathmandu']);
    $now=time();
    $from=(new DateTimeImmutable('tomorrow',new DateTimeZone('Asia/Kathmandu')))->modify('-7 days')->getTimestamp();
    foreach (['v2_login_log','v2_subscribe_log','v2_risk_rule_hit','v2_order','v2_payment_callback_event','v2_mail_log','v2_daily_task_run','v2_analytics_session'] as $table) DB::table($table)->delete();
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
    DB::table('v2_daily_task_run')->insert(['task'=>'v2board:statistics','business_date'=>$today,'timezone'=>'Asia/Kathmandu','status'=>'completed','updated_at'=>$now-40]);
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
    $statisticsTask=collect($report['health']['dailyTasks'])->firstWhere('task','fastai:statistics');
    $assert($statisticsTask && $statisticsTask['status']==='completed' && $statisticsTask['lastSuccessAt']===gmdate('c',$now-40), 'Canonical statistics health must read its existing daily status and successful timestamp');
    $assert(!collect($report['health']['dailyTasks'])->contains('task','v2board:statistics'), 'Operations output must use only the canonical statistics name');
    $assert($report['login']['clients']['uniqueIps']===1 && $report['login']['clients']['topIps'][0]['maskedIp']==='192.0.2.***','Existing IPs are counted by scope and masked');
    $assert($report['subscription']['clients']['uniqueIps']===0 && $report['subscription']['clients']['unknownIpEvents']===3,'Missing IPs are not counted as visitors');
    $serialized=json_encode($report);
    foreach (['private@example.com','192.0.2.1','token=','another-secret','test-secret','private-note','code-secret'] as $secret) $assert(!str_contains($serialized,$secret),'Report does not expose '.$secret);
    $assert(App\Services\OperationsAnalytics::rate(0,0)===null,'Zero denominator is unavailable, not zero percent');
    // Non-integral-hour timezone and local midnight boundary coverage.
    $at=(new DateTimeImmutable('yesterday 00:05',$zone))->getTimestamp();
    DB::table('v2_analytics_session')->insert(['session_hash'=>str_repeat('a',64),'created_at'=>$at,'last_at'=>$at,'device'=>'desktop','stage'=>3]);
    DB::table('v2_analytics_session')->insert(['session_hash'=>str_repeat('b',64),'created_at'=>$at-600,'last_at'=>$at-600,'device'=>'mobile','stage'=>0]);
    $analytics=new App\Services\ProductAnalytics();
    $visits=$analytics->report(7,'all');
    $dayCounts=array_column($visits['daily'],'sessions','date');
    $assert($dayCounts[(new DateTimeImmutable('yesterday',$zone))->format('Y-m-d')]===1
        && $dayCounts[(new DateTimeImmutable('2 days ago',$zone))->format('Y-m-d')]===1 && $visits['sessions']===2,
        'Session trends respect a quarter-hour-offset timezone at midnight');
    $assert($analytics->report(7,'desktop')['sessions']===1,'Session trends respect the device filter');
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
    foreach (['v2_analytics_measurement','v2_analytics_session','v2_login_log','v2_subscribe_log','v2_stat_user','v2_order','v2_user'] as $table) DB::table($table)->delete();
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
        $order=$makeOrder($u,$paidAt);
        if ($u->id===$b->id) $order->update(['total_amount'=>0,'balance_amount'=>1000]);
        DB::table('v2_subscribe_log')->insert(['user_id'=>$u->id,'status'=>'success','created_at'=>$paidAt+600]);
    }
    $makeOrder($b,(int)$b->getRawOriginal('created_at')+10*86400,2)->update(['total_amount'=>0,'balance_amount'=>1000]);
    $makeOrder($d,(int)$d->getRawOriginal('created_at')+100,1,'reset_price');
    $makeOrder($d,(int)$d->getRawOriginal('created_at')+200)->update(['status'=>2]);
    foreach ([$a,$b,$administrator] as $u) {
        $recordAt=$today->modify('-4 days')->getTimestamp();
        foreach ([1,2] as $rate) DB::table('v2_stat_user')->insert(['user_id'=>$u->id,'server_rate'=>$rate,'u'=>1,'d'=>1,'record_type'=>'d','record_timezone'=>'Asia/Kathmandu','record_at'=>$recordAt,'created_at'=>$recordAt+3600,'updated_at'=>$recordAt+3600]);
        foreach ([0,1] as $duplicate) DB::table('v2_login_log')->insert(['user_id'=>$u->id,'is_success'=>1,'created_at'=>$recordAt+3600+$duplicate]);
    }
    $journey=(new App\Services\JourneyAnalytics())->report(7);
    $activation=$journey['activation'];
    $assert($activation['registered']===2 && $activation['paid']===1 && $activation['subscribed']===1 && $activation['used']===1,'Activation excludes immature/admin accounts, reset orders and cancelled orders');
    $assert($activation['averagePaymentSeconds']===3600 && $activation['averageSubscriptionSeconds']===600,'Exact paid/subscribe latency uses authoritative ordered timestamps');
    $assert($journey['retentionCohorts'][0]['registered']===2 && $journey['retentionCohorts'][0]['login']===1 && $journey['retentionCohorts'][0]['usage']===1 && $journey['retentionCohorts'][0]['usageRate']===0.5,'D7 retention deduplicates repeated logins and traffic-rate buckets');
    $assert($journey['retentionCohorts'][1]['registered']===1 && $journey['retentionCohorts'][1]['loginRate']===1.0,'D30 uses its own fully observed registration cohort');
    $assert($journey['repurchase']['eligible']===1 && $journey['repurchase']['renewed']===1 && $journey['repurchase']['rate']===1.0,'Repurchase counts first positive payments and later type-2 payments funded entirely by wallet balance');
    $assert($journey['expiredUnrestored']===1 && $journey['active'][1]['login']===2 && $journey['active'][1]['usage']===2,'Expiry is a current mature snapshot; active counts exclude administrators');
    $assert(!str_contains(json_encode($journey),'journey-a@example.test'),'Journey reports expose no account identifiers');
    $analytics->save(['enabled'=>true,'retentionDays'=>7]);
    $event=['sessionId'=>(string)Illuminate\Support\Str::uuid(),'page'=>'plan','device'=>'desktop','language'=>'zh-CN','consent'=>true];
    $analytics->record($event);
    foreach ([100,200,500,10000] as $value) $analytics->record($event+['event'=>'lcp','value'=>$value]);
    $analytics->record(array_replace($event,['page'=>'payment','event'=>'copy_failed']));
    $measurement=new App\Services\ExperienceMeasurements();
    $measured=$measurement->report(7,'desktop');
    $lcp=collect($measured['rows'])->firstWhere('event','lcp');
    $repeatMigration=require database_path('migrations/2026_10_19_000001_create_analytics_measurements.php');
    $repeatMigration->up();
    $assert(DB::table('v2_analytics_measurement')->sum('samples')==5,'Measurement migration is idempotent and preserves existing observations');
    $assert($lcp['samples']===4 && $lcp['sessions']===1 && $lcp['average']===2700.0 && $lcp['p75Upper']===500 && $lcp['p95Upper']===10000,'Numeric histograms retain exact sums and expose estimated percentile bucket bounds');
    $session=DB::table('v2_analytics_session')->first();
    $assert(!array_intersect(['browser','browser_major','embedded','language','os'],array_keys((array)$session))
        && !Illuminate\Support\Facades\Schema::hasTable('v2_analytics_page'), 'Retired session dimensions and page-view table are absent');
    $assert($session->stage===1,'Error and numeric events never advance the purchase path');
    $assert($measurement->report(7,'mobile')['rows']===[],'Experience reports respect anonymous device filtering');
    $analytics->record(array_replace($event,['page'=>'payment','event'=>'payment_open']));
    $assert(!DB::table('v2_analytics_measurement')->where('event','payment_open')->exists()
        && DB::table('v2_analytics_session')->first()->stage===1,'Retired payment clicks never persist or advance the purchase path');

    DB::table('v2_analytics_measurement')->where('event','lcp')->where('bucket',100)->update(['samples'=>196]);
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
    $attempts=Illuminate\Support\Facades\RateLimiter::attempts('product-analytics-global');
    foreach (['download','copy_success','import_start','help_open','guide_manual','guide_continue','payment_open'] as $retired) {
        $response=$invoke(['sessionId'=>(string)Illuminate\Support\Str::uuid(),'page'=>'payment','event'=>$retired]);
        $assert($response->getStatusCode()===204 && str_contains($response->headers->get('Cache-Control'),'no-store'),
            'Valid legacy action is accepted without recording: '.$retired);
    }
    $assert(DB::table('v2_analytics_session')->count()===1 && (int)DB::table('v2_analytics_measurement')->sum('samples')===200
        && Illuminate\Support\Facades\RateLimiter::attempts('product-analytics-global')===$attempts,
        'Retired actions consume neither session storage, sample allowance nor global collection quota');
    $assert($invoke(['event'=>'lcp','value'=>100],['HTTP_SEC_GPC'=>'1'])->getStatusCode()===204 && (int)DB::table('v2_analytics_measurement')->sum('samples')===200,'GPC prevents optional metric storage');
    $referral=array_replace($event,['sessionId'=>(string)Illuminate\Support\Str::uuid(),'attributionVersion'=>1,'sourceDomain'=>'partner.example.test']);
    foreach (['plan','confirmation','payment'] as $page) $analytics->record(array_replace($referral,['page'=>$page]));
    $analytics->record($referral+['event'=>'js_error']);
    $analytics->record(array_replace($referral,['sessionId'=>(string)Illuminate\Support\Str::uuid(),'sourceDomain'=>null]));
    $analytics->record(array_replace($referral,['sessionId'=>(string)Illuminate\Support\Str::uuid(),'device'=>'mobile']));
    $traffic=$analytics->report(7,'desktop','traffic');
    $assert($traffic['sessions']===3 && array_sum(array_column($traffic['daily'],'sessions'))===3
        && $traffic['sourceCoverage']===['known'=>1,'unknown'=>1,'historical'=>1],
        'Dashboard coverage reconciles to all sampled sessions and respects the device filter');
    $assert($traffic['sources']===[['domain'=>'partner.example.test','sessions'=>1,'paymentEntries'=>1]]
        && !isset($traffic['views'],$traffic['receipts'],$traffic['browsers']) && !array_key_exists('views',$traffic['daily'][0]),
        'Traffic projection exposes ordered checkout intent for attributable sessions and skips unused report dimensions');
    $assert(array_column($analytics->report(7,'desktop','conversion')['funnel'],'sessions')===[3,1,1],
        'Dashboard conversion uses the ordered stages for each anonymous session');
    $assert(array_column($measurement->report(7,'desktop')['rows'],'event')===['copy_failed','js_error','lcp'],
        'Dashboard experience keeps errors and performance while omitting click-only action counters');
    DB::table('v2_analytics_session')->update(['created_at'=>$now-8*86400]);
    $analytics->prune();
    $assert(DB::table('v2_analytics_measurement')->count()===0,'Existing privacy retention removes measurement buckets with sessions');
    $analytics->save(['enabled'=>false,'retentionDays'=>7]);
    // Purchase identity is lifetime history, not Order.type or browser events.
    // Keep this regression in the existing disposable analytics fixture.
    DB::table('v2_order')->delete(); DB::table('v2_user')->delete();
    $registrationCohort=new ReflectionMethod($analytics,'registrationCohort');
    $purchaseWindow=new ReflectionMethod($analytics,'firstPurchase');
    $cohortCases=[
        ['America/New_York','2026-03-09 00:30:00','2026-03-01T00:00:00-05:00'],
        ['America/New_York','2026-03-09 01:00:00','2026-03-02T00:00:00-05:00'],
        ['America/New_York','2026-11-02 00:30:00','2026-10-26T00:00:00-04:00'],
        ['America/New_York','2026-11-02 23:00:00','2026-10-27T00:00:00-04:00'],
        ['UTC','2026-03-09 00:30:00','2026-03-02T00:00:00+00:00'],
        ['Asia/Shanghai','2026-03-09 00:30:00','2026-03-02T00:00:00+08:00'],
        ['Asia/Kathmandu','2026-03-09 00:30:00','2026-03-02T00:00:00+05:45'],
    ];
    foreach($cohortCases as $case=>[$zoneName,$localNow,$expectedEnd]) {
        DB::table('v2_order')->delete(); DB::table('v2_user')->delete();
        $fixedZone=new DateTimeZone($zoneName);$fixedNow=(new DateTimeImmutable($localNow,$fixedZone))->getTimestamp();
        [$fixedCohort,$fixedStart,$fixedEnd]=$registrationCohort->invoke($analytics,7,$fixedNow,$fixedZone);
        $endDate=(new DateTimeImmutable('@'.$fixedEnd))->setTimezone($fixedZone);
        $assert($endDate->format('c')===$expectedEnd && $fixedStart===$endDate->modify('-7 days')->getTimestamp(),
            'Registration cohorts retain complete local dates after an elapsed 168-hour cutoff: '.$zoneName.' '.$localNow);
        $assert($fixedEnd<=$fixedNow-604800 && $endDate->modify('+1 day')->getTimestamp()>$fixedNow-604800,
            'The cohort ends at the latest whole registration date whose entire observation window is mature');
        $accounts=[];
        foreach(['before_start'=>$fixedStart-1,'at_start'=>$fixedStart,'last_complete'=>$fixedEnd-1,'at_end'=>$fixedEnd,'immature'=>$fixedNow-604800+1] as $label=>$created) {
            $accounts[$label]=App\Models\User::create(['email'=>'cohort-boundary-'.$case.'-'.$label.'@example.test','password'=>'fixture',
                'token'=>App\Utils\Helper::guid(),'uuid'=>App\Utils\Helper::guid(true),'is_admin'=>0,'created_at'=>$created,'updated_at'=>$created]);
        }
        $selected=(clone $fixedCohort)->orderBy('u.created_at')->pluck('u.id')->map(fn($id)=>(int)$id)->all();
        $assert($selected===[(int)$accounts['at_start']->id,(int)$accounts['last_complete']->id]
            && $fixedNow-(int)$accounts['last_complete']->getRawOriginal('created_at')>=604800,
            'The actual cohort query includes its start, excludes its end and never selects an incomplete observation window');
        if($case===1) $assert($fixedNow-$fixedEnd===604800 && !in_array((int)$accounts['at_end']->id,$selected,true),
            'An exactly mature midnight starts the next excluded calendar date');
        if($case===1) {
            $makeOrder($accounts['at_start'],(int)$accounts['at_start']->getRawOriginal('created_at')+604799)->update(['total_amount'=>0,'balance_amount'=>1000]);
            $makeOrder($accounts['last_complete'],(int)$accounts['last_complete']->getRawOriginal('created_at')+604800)->update(['total_amount'=>0,'balance_amount'=>1000]);
            $fixedPurchases=$purchaseWindow->invoke($analytics,$fixedCohort,2,$fixedStart,$fixedEnd);
            $assert($fixedPurchases['registered']===2 && $fixedPurchases['verifiedRecurringAccounts']===1,
                'First purchase includes payment at 604799 elapsed seconds and excludes the exact 604800-second boundary across DST');
        }
    }
    DB::table('v2_order')->delete(); DB::table('v2_user')->delete();
    $purchaseToday=new DateTimeImmutable('today',new DateTimeZone(App\Services\TimeZones::system()));
    $purchaseUser=function(string $name,int $age=10,bool $admin=false) use($purchaseToday) {
        $created=$purchaseToday->modify('-'.$age.' days')->getTimestamp()+3600;
        return App\Models\User::create(['email'=>'purchase-'.$name.'@example.test','password'=>'fixture','token'=>App\Utils\Helper::guid(),'uuid'=>App\Utils\Helper::guid(true),'is_admin'=>$admin,'created_at'=>$created,'updated_at'=>$created]);
    };
    $purchaseOrder=function($account,int $amount,array $overrides=[]) {
        $at=(int)$account->getRawOriginal('created_at')+100;
        return Order::create(array_replace(['user_id'=>$account->id,'plan_id'=>1,'type'=>1,'period'=>'month_price','trade_no'=>App\Utils\Helper::generateOrderNo(),'total_amount'=>$amount,'balance_amount'=>0,'status'=>3,'paid_at'=>$at,'created_at'=>$at-5,'updated_at'=>$at],$overrides));
    };
    $external=$purchaseUser('external');
    $purchaseOrder($external,1000,['type'=>2,'payment_id'=>$payment->id,'callback_no'=>'paid-first']);
    $purchaseOrder($external,2000,['payment_id'=>$payment->id,'callback_no'=>'paid-again','paid_at'=>(int)$external->getRawOriginal('created_at')+200]);
    $mixed=$purchaseUser('mixed');
    $purchaseOrder($mixed,0,['paid_at'=>(int)$mixed->getRawOriginal('created_at')+50]);
    $purchaseOrder($mixed,400,['type'=>3,'balance_amount'=>600,'payment_id'=>$payment->id,'callback_no'=>'paid-mixed']);
    $wallet=$purchaseUser('wallet');
    $purchaseOrder($wallet,2000,['plan_id'=>0,'period'=>'deposit','type'=>9,'paid_at'=>(int)$wallet->getRawOriginal('created_at')+20]);
    $purchaseOrder($wallet,0,['balance_amount'=>1000]);
    $manual=$purchaseUser('manual'); $purchaseOrder($manual,1000,['callback_no'=>'manual_operation','payment_id'=>$payment->id]);
    $unknown=$purchaseUser('unknown'); $purchaseOrder($unknown,1000);
    $purchaseOrder($manual,1000,['payment_id'=>$payment->id,'callback_no'=>'verified-after-manual','paid_at'=>(int)$manual->getRawOriginal('created_at')+200]);
    $purchaseOrder($unknown,0,['balance_amount'=>1000,'paid_at'=>(int)$unknown->getRawOriginal('created_at')+200]);
    $free=$purchaseUser('free'); $purchaseOrder($free,0);
    $exchange=$purchaseUser('exchange'); $purchaseOrder($exchange,0,['surplus_amount'=>1500,'refund_amount'=>500]);
    $credits=$purchaseUser('credits'); $purchaseOrder($credits,400,['period'=>'onetime_price','type'=>5,'credit_bytes'=>1073741824]);
    $creditOrder=['period'=>'onetime_price','type'=>5,'credit_bytes'=>1073741824];
    $purchaseOrder($credits,400,$creditOrder+['payment_id'=>$payment->id,'callback_no'=>'credit-external']);
    $purchaseOrder($credits,0,$creditOrder+['balance_amount'=>400]);
    $purchaseOrder($manual,400,$creditOrder+['payment_id'=>$payment->id,'callback_no'=>'manual_operation']);
    $purchaseOrder($unknown,400,$creditOrder);
    $reset=$purchaseUser('reset'); $purchaseOrder($reset,300,['period'=>'reset_price','type'=>4]);
    $legacy=$purchaseUser('legacy'); $purchaseOrder($legacy,600,['period'=>'onetime_price']);
    $late=$purchaseUser('late'); $purchaseOrder($late,1000,['paid_at'=>(int)$late->getRawOriginal('created_at')+604800]);
    $cancelled=$purchaseUser('cancelled'); $purchaseOrder($cancelled,1000,['status'=>2]);
    $prior=$purchaseUser('prior');
    $purchaseOrder($prior,1000,['paid_at'=>(int)$prior->getRawOriginal('created_at')-100]);
    $purchaseOrder($prior,1000);
    $tied=$purchaseUser('tied');
    $purchaseOrder($tied,100,['balance_amount'=>900,'payment_id'=>$payment->id,'callback_no'=>'tied-first']);
    $purchaseOrder($tied,0,['balance_amount'=>1000]);
    $placeholder=$purchaseUser('placeholder'); $purchaseOrder($placeholder,0,['balance_amount'=>1000,'credit_bytes'=>0]);
    $negative=$purchaseUser('negative');
    try { $purchaseOrder($negative,1000,['credit_bytes'=>-1]); throw new RuntimeException('Unsigned credit-byte metadata accepted a negative entitlement'); }
    catch (Illuminate\Database\QueryException $error) { $assert(true,'The persisted entitlement schema rejects negative credit bytes'); }
    $immature=$purchaseUser('immature',2); $purchaseOrder($immature,1000);
    $admin=$purchaseUser('admin',10,true); $purchaseOrder($admin,1000);
    $purchaseReport=$analytics->report(7,'mobile'); $first=$purchaseReport['firstPurchase'];
    $assert($first['registered']===16 && $first['verifiedRecurringAccounts']===5,'First purchase uses mature registrations and the earliest lifetime valued recurring purchase');
    $assert($first['funding']===['externalOnly'=>1,'mixed'=>2,'walletOnly'=>2,'manual'=>1,'unclassified'=>1],'First-purchase funding includes zero credit-byte placeholders but excludes invalid negative entitlements');
    $assert($first===$analytics->report(7,'desktop')['firstPurchase'],'Business purchases do not depend on consent, collection enablement or browser device');
    $assert(isset($purchaseReport['sessions'],$purchaseReport['funnel']) && !array_intersect(
        ['cohort','receipts','browsers','browsersReady','pages','views','latestEventAt','hours','weekdays','devices'],array_keys($purchaseReport))
        && !str_contains(json_encode($first),'@example.test'),'Default report returns retained metrics and keeps purchase identity anonymous');
    $dashboardConversion=$analytics->report(7,'mobile','conversion'); $dashboardPurchase=$dashboardConversion['firstPurchase'];
    $assert($dashboardPurchase['registered']===16 && $dashboardPurchase['verifiedRecurringAccounts']===5
        && $dashboardPurchase['verifiedCreditAccounts']===1 && $dashboardPurchase['funding']['manual']===1
        && $dashboardPurchase['funding']['unclassified']===1 && !isset($dashboardConversion['receipts'],$dashboardConversion['cohort']),
        'Dashboard conversion excludes unverifiable first purchases and deduplicates verified independent quota purchases');

    DB::table('v2_order')->delete(); DB::table('v2_user')->delete();
    $immatureAccount=$purchaseUser('immature-only',1);
    $emptyFirst=$analytics->report(7,'all')['firstPurchase'];
    $assert($emptyFirst['registered']===0 && $emptyFirst['verifiedRecurringAccounts']===0
        && $emptyFirst['verifiedCreditAccounts']===0,'Immature accounts never supply a conversion denominator');
    $noticeReasons=['traffic_exhausted','credits_expired','credits_exhausted','no_available_nodes','subscription_changed'];
    foreach($noticeReasons as $reason)DB::table('v2_subscribe_log')->insert(['user_id'=>$immatureAccount->id,'status'=>'failed','reason'=>$reason,'created_at'=>time()-10]);
    $noticeCounts=array_column($service->report(7)['subscription']['reasons'],'count','reason');
    foreach($noticeReasons as $reason)$assert(($noticeCounts[$reason]??0)===1,'Operational reports preserve a distinct safe notice reason: '.$reason);
    echo "PASS {$n} admin payment/version/operations/journey checks\n";
} finally { DB::rollBack(); }
