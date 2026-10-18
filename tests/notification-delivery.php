<?php
// Isolated integration checks. No real mail or Telegram transport is allowed.
require __DIR__.'/../vendor/autoload.php';
class NotificationTestCurl {
    public static $respond;
    public static array $calls = [];
    public $response;
    public function setOpt($key, $value) {}
    public function post($url, $params) {
        $method = basename($url);
        self::$calls[] = [$method, $params];
        if (!self::$respond) throw new RuntimeException('Unexpected Telegram call');
        $this->response = (self::$respond)($method, $params);
    }
    public function close() {}
}
if (class_exists('Curl\\Curl', false)) throw new RuntimeException('Transport already loaded');
class_alias(NotificationTestCurl::class, 'Curl\\Curl');
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(function ($e) { fwrite(STDERR, 'FAIL: '.get_class($e).': '.$e->getMessage().' at '.basename($e->getFile()).':'.$e->getLine().PHP_EOL); exit(1); });
if (!app()->environment(['local', 'testing'])) throw new RuntimeException('Local/testing only');
use Illuminate\Support\Facades\{DB, Schema, Cache, Http, Crypt, Mail, Queue};
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use App\Services\{MailgunSender, MailDeliveryLog, MailRateLimiter, TelegramCommunityService, TelegramDeliveryService, TelegramService, TelegramText};
use App\Jobs\{SendEmailJob, SendTelegramPaymentJob};
use App\Models\{User, Order, MailLog};
use App\Exceptions\MailgunSendException;

$mysql = getenv('NOTIFICATION_TEST_DATABASE');
if ($mysql) {
    if (!preg_match('/^notification_test_[a-f0-9]{8}$/D', $mysql)) throw new RuntimeException('Unsafe test database name');
    $connection = config('database.connections.mysql'); $connection['database']=$mysql;
    config(['database.connections.notification_test'=>$connection]);
} else {
    config(['database.connections.notification_test'=>['driver'=>'sqlite','database'=>':memory:','prefix'=>'','foreign_key_constraints'=>true]]);
}
config(['database.default'=>'notification_test', 'cache.default'=>'array', 'queue.default'=>'sync', 'logging.default'=>'stderr',
    'v2board.email_provider'=>'smtp', 'v2board.email_host'=>null, 'v2board.app_name'=>'Test Site',
    'v2board.app_url'=>'https://example.test', 'v2board.telegram_bot_enable'=>1, 'v2board.telegram_bot_token'=>'999999:TEST_ONLY',
    'v2board.telegram_group_policy_enable'=>0, 'v2board.telegram_discuss_id'=>-100999,
    'v2board.telegram_group_grace_days'=>3]);
DB::purge('notification_test');
if (Schema::hasTable('v2_user')) throw new RuntimeException('Test requires an empty disposable database');
$fakeHttp = function ($callbacks = []) {
    Http::swap(new Illuminate\Http\Client\Factory);
    Http::preventStrayRequests();
    Http::fake($callbacks);
};
$fakeHttp();
Queue::fake();
Mail::fake();
$checks=0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$reject = function (callable $fn, int $status) use ($assert) {
    try { $fn(); throw new RuntimeException('Expected rejection '.$status); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===$status, 'Wrong rejection status'); }
};
Schema::create('v2_user', function (Blueprint $t) {
    $t->bigIncrements('id'); $t->string('email')->unique(); $t->bigInteger('telegram_id')->nullable(); $t->string('language')->nullable();
    $t->integer('is_admin')->default(0); $t->integer('banned')->default(0); $t->integer('plan_id')->nullable(); $t->bigInteger('expired_at')->nullable();
    $t->bigInteger('created_at')->nullable(); $t->bigInteger('updated_at')->nullable();
});
Schema::create('v2_order', function (Blueprint $t) {
    $t->bigIncrements('id'); $t->bigInteger('user_id'); $t->string('trade_no'); $t->integer('status'); $t->bigInteger('paid_at')->nullable();
    $t->string('currency',3)->default('CNY'); $t->integer('total_amount'); $t->bigInteger('created_at')->nullable(); $t->bigInteger('updated_at')->nullable();
});
Schema::create('v2_mail_log', function (Blueprint $t) {
    $t->increments('id'); $t->string('email',64); $t->string('subject'); $t->string('template_name'); $t->text('error')->nullable();
    $t->integer('created_at'); $t->integer('updated_at');
});
$one=User::create(['email'=>'one@example.test','telegram_id'=>111,'language'=>'zh-TW']);
User::create(['email'=>'duplicate1@example.test','telegram_id'=>222]);
User::create(['email'=>'duplicate2@example.test','telegram_id'=>222]);
foreach (['2026_10_13_000005_add_telegram_membership.php','2026_10_14_000001_harden_telegram_delivery.php','2026_10_14_000002_add_mail_delivery_metadata.php','2026_10_14_000003_add_mail_transport_codes.php','2026_10_14_000004_add_mail_feedback.php','2026_10_14_000005_add_mail_campaigns.php','2026_10_14_000006_add_mail_blocklist.php','2026_10_14_000011_add_optional_mfa.php'] as $name) {
    $migration=require __DIR__.'/../database/migrations/'.$name;
    $migration->up(); $migration->up(); // Safe retry after interrupted upgrades.
}
// The fixture creates users before migrations; restart Eloquent's schema cache like a deployed worker restart.
(new ReflectionProperty(Illuminate\Database\Eloquent\Model::class,'guardableColumns'))->setValue(null,[]);
$assert(DB::table('v2_telegram_identity')->count()===1, 'Ambiguous identities were backfilled');
$assert(DB::table('v2_telegram_identity')->where('telegram_id',111)->value('user_id')==$one->id, 'Identity backfill failed');
$assert(Schema::hasColumns('v2_mail_log',['provider','status','recipient_hash','duration_ms']), 'Mail migration incomplete');
echo "PASS migrations and duplicate identity backfill\n";

// Transport boundaries and classifications, US/EU and secrets.
config(['v2board.email_mailgun_domain'=>'mg.example.test','v2board.email_mailgun_region'=>'us',
    'v2board.email_mailgun_api_key'=>Crypt::encryptString('TEST_KEY_SENTINEL'), 'v2board.email_from_address'=>'sender@example.test']);
$data=app(App\Services\ProductMail::class)->data(['template_name'=>'test','language'=>'en-US']);
$sender=new MailgunSender;
foreach (['us'=>'api.mailgun.net','eu'=>'api.eu.mailgun.net'] as $region=>$host) {
    config(['v2board.email_mailgun_region'=>$region]);
    $fakeHttp([$host.'/*'=>Http::response(['id'=>'<test@example.test>'],200)]);
    $assert($sender->send('recipient@example.test',$data)==='<test@example.test>', 'Message ID missing');
    Http::assertSent(function ($r) use ($host) {
        $fields = array_column($r->data(), 'contents', 'name');
        return $r->url()==='https://'.$host.'/v3/mg.example.test/messages'
            && $r->hasHeader('Authorization','Basic '.base64_encode('api:TEST_KEY_SENTINEL'))
            && $fields['to']==='recipient@example.test' && $fields['o:tracking']==='no'
            && $fields['o:tracking-clicks']==='no' && $fields['o:tracking-opens']==='no';
    });
    $checks++;
}
foreach ([400=>'MAILGUN_REQUEST_REJECTED',401=>'MAILGUN_AUTH_REJECTED',403=>'MAILGUN_AUTH_REJECTED',404=>'MAILGUN_DOMAIN_NOT_FOUND',429=>'MAILGUN_RATE_LIMITED',500=>'MAILGUN_SERVER_UNKNOWN',302=>'MAILGUN_REQUEST_FAILED'] as $status=>$code) {
    $fakeHttp(['*'=>Http::response('PRIVATE_PROVIDER_BODY', $status)]);
    try { $sender->send('recipient@example.test',$data); throw new RuntimeException('Expected provider rejection'); }
    catch (MailgunSendException $e) {
        $assert($e->safeCode===$code, 'Wrong provider classification: '.$status);
        $assert($e->retryable===($status===429) && $e->uncertain===($status===500), 'Unsafe retry classification');
        $assert(!str_contains($e->getMessage(),'PRIVATE_PROVIDER_BODY'), 'Provider body leaked');
    }
}
foreach ([fn()=>Http::failedConnection(), fn()=>Http::response(['message'=>'queued'],200)] as $response) {
    $fakeHttp(['*'=>$response()]);
    try { $sender->send('recipient@example.test',$data); throw new RuntimeException('Expected unknown outcome'); }
    catch (MailgunSendException $e) { $assert($e->uncertain && !$e->retryable,'Unknown delivery automatically retryable'); }
}
foreach (['https://evil.test','../evil','mg.example.test/path'] as $domain) {
    config(['v2board.email_mailgun_domain'=>$domain]); $fakeHttp();
    try { $sender->send('recipient@example.test',$data); throw new RuntimeException('Unsafe domain accepted'); }
    catch (MailgunSendException $e) { $assert($e->safeCode==='MAILGUN_CONFIG_INVALID', 'Wrong config rejection'); }
    Http::assertNothingSent(); $checks++;
}
config(['v2board.email_mailgun_domain'=>'mg.example.test']);
$app->instance(MailRateLimiter::class,new class extends MailRateLimiter {
    public function acquire($email,$bulk,$priority=false) { return 0; }
    public function cooldown($email,$priority=false) {}
});
config(['v2board.email_provider'=>'mailgun']);
$params=['email'=>'private-recipient@example.test','language'=>'en-US','template_name'=>'test'];
$fakeHttp(['*'=>Http::response(['id'=>'<receipt@example.test>'],200)]);
$result=(new SendEmailJob($params))->handle();
$log=MailLog::findOrFail($result['log_id']);
$assert($log->status==='accepted' && $log->subject==='' && $log->error===null, 'Unsafe success receipt');
$assert(!str_contains($log->email,'private-recipient') && $log->recipient_hash===MailDeliveryLog::recipientHash($params['email']), 'Recipient privacy failed');
$fakeHttp(['*'=>Http::failedConnection()]);
$result=(new SendEmailJob($params))->handle();
$assert($result['permanent'] && MailLog::find($result['log_id'])->status==='uncertain','Timeout auto-retry risk');
$before=MailLog::count();
$fakeHttp();
$otp=$params+['template_value'=>['code'=>'PRIVATE_OTP']]; $otp['template_name']='verify';
(new SendEmailJob($otp))->handle();
Http::assertNothingSent(); $assert(MailLog::count()===$before, 'Expired OTP was sent/logged as attempted');
Cache::put(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',strtolower($otp['email'])),'PRIVATE_OTP',300);
$fakeHttp(['*'=>Http::response(['id'=>'<otp@example.test>'],200)]);
(new SendEmailJob($otp))->handle();
$assert(!str_contains(MailLog::all()->toJson(),'PRIVATE_OTP'), 'OTP leaked into mail logs');
$controller=new App\Http\Controllers\V1\Admin\MailLogController;
$r=$controller->fetch(Request::create('/','GET',['email'=>$params['email'],'status'=>'accepted']));
$rows=json_decode($r->getContent(),true);
$assert($rows['total']===2 && count($rows['data'])===2, 'Mail filtering failed');
$assert(!str_contains(json_encode($rows),'PRIVATE_OTP') && !array_key_exists('subject',$rows['data'][0]),'Mail API leaked fields');
MailLog::create(['email'=>'old@example.test','subject'=>'PRIVATE_OLD_SUBJECT','template_name'=>'mail.product.test','error'=>'PRIVATE_OLD_ERROR']);
$legacy=json_decode($controller->fetch(Request::create('/','GET',['status'=>'legacy']))->getContent(),true);
$assert($legacy['total']===1 && !str_contains(json_encode($legacy),'PRIVATE_OLD'),'Legacy error leaked');
MailLog::where('status','accepted')->first()->update(['status'=>'sending','created_at'=>time()-300]);
$assert(json_decode($controller->fetch(Request::create('/','GET',['status'=>'uncertain']))->getContent(),true)['total']===2,'Stuck attempt not shown as uncertain');
try { $controller->fetch(Request::create('/','GET',['page_size'=>1000])); throw new RuntimeException('Pagination unbounded'); }
catch (Illuminate\Validation\ValidationException $e) { $checks++; }
$reject(fn()=>$controller->fetch(Request::create('/','GET',['from'=>20,'to'=>10])),422);
$conf=json_decode((new App\Http\Controllers\V1\Admin\ConfigController)->fetch(Request::create('/','GET',['key'=>'email']))->getContent(),true);
$assert(!str_contains(json_encode($conf),'TEST_KEY_SENTINEL') && !str_contains(json_encode($conf),config('v2board.email_mailgun_api_key')), 'Config exposes API key');
echo "PASS Mailgun transport, privacy, log search and OTP expiry\n";


// SMTP compatibility stays covered with a mocked transport and safe error output.
config(['v2board.email_provider'=>'smtp']);
$transport=new class {
    public int $sent=0; public $error;
    public function forgetMailers() {}
    public function send($views,$data,$callback) { $this->sent++; if ($this->error) throw $this->error; }
};
Mail::swap($transport);
$result=(new SendEmailJob($params))->handle();
$assert($result['status']==='accepted' && $transport->sent===1,'SMTP compatibility failed');
foreach ([421=>false,550=>true] as $code=>$permanent) {
    $transport->error=new RuntimeException('PRIVATE_SMTP_BODY Expected code 250 but got code "'.$code.'"');
    $result=(new SendEmailJob($params))->handle();
    $assert($result['permanent']===$permanent && !str_contains(json_encode($result),'PRIVATE_SMTP_BODY'),'SMTP classification or secrecy failed');
}
$transport->error=null;
$unsafe=$params; $unsafe['email']="valid@example.test\r\nBcc:attacker@example.test";
$before=$transport->sent; $result=(new SendEmailJob($unsafe))->handle();
$assert($result['permanent'] && $transport->sent===$before, 'Header injection reached SMTP');

// Exercise the actual admin authorization middleware with isolated cached sessions.
$adminGate=new App\Http\Middleware\Admin;
$reject(fn()=>$adminGate->handle(Request::create('/','GET'),fn()=>response('ok')),403);
$auth=(new App\Services\AuthService($one))->generateAuthData(Request::create('/','POST'));
$authRequest=Request::create('/','GET'); $authRequest->headers->set('Authorization',$auth['auth_data']);
$reject(fn()=>$adminGate->handle($authRequest,fn()=>response('ok')),403);
$one->is_admin=1; $one->save();
$assert($adminGate->handle($authRequest,fn()=>response('ok'))->getStatusCode()===200,'Admin unable to access logs');
$one->banned=1; $one->save();
$reject(fn()=>$adminGate->handle($authRequest,fn()=>response('ok')),403);
$one->banned=0; $one->is_admin=0; $one->save();
echo "PASS SMTP compatibility and administrator authorization\n";

// Binding possession/confirmation and language selection.
$community=new TelegramCommunityService;
$assert($community->userForTelegram(222)===null,'Ambiguous Telegram account accepted');
$two=User::create(['email'=>'two@example.test','language'=>'ja-JP']);
$token=str_repeat('a',48);
DB::table('v2_telegram_binding_challenge')->insert(['user_id'=>$two->id,'token_hash'=>hash('sha256',$token),'expires_at'=>time()+600]);
$assert(TelegramText::language(333,'en','bind_'.$token)==='ja-JP','Pending binding ignored website language');
$community->acceptBinding($token,333,'Test Name');
$reject(fn()=>$community->confirmBinding($two,'334'),409);
$reject(fn()=>$community->acceptBinding($token,334,'Wrong Account'),409);
$community->confirmBinding($two,'333');
$assert($two->fresh()->telegram_id==333 && DB::table('v2_telegram_identity')->where('telegram_id',333)->exists(),'Binding claim failed');
$assert(TelegramText::language(333,'ru')==='ja-JP','Telegram language overrode website');
$reject(fn()=>$community->confirmBinding($two,'333'),409);
$three=User::create(['email'=>'three@example.test']);
DB::table('v2_telegram_binding_challenge')->insert(['user_id'=>$three->id,'token_hash'=>hash('sha256',str_repeat('b',48)),'telegram_id'=>333,'expires_at'=>time()+600]);
$reject(fn()=>$community->confirmBinding($three,'333'),409);
$community->unbind($two);
$assert($two->fresh()->telegram_id===null && !DB::table('v2_telegram_identity')->where('telegram_id',333)->exists(),'Unbind did not release claim');
$community->confirmBinding($three,'333');
$assert($three->fresh()->telegram_id==333,'Released identity cannot rebind');
foreach (App\Services\LanguagePreferenceService::SUPPORTED as $lang) {
    $text=TelegramText::get('payment',$lang,['amount'=>'1.00','order'=>'TEST_ORDER']);
    $assert(str_contains($text,'TEST_ORDER') && !str_contains($text,':amount'), 'Missing translated payment placeholders');
    $assert(count(TelegramText::commandsFor($lang))===4,'Missing localized command menu');
}
$assert(TelegramText::normalize('zh_Hant')==='zh-TW' && TelegramText::normalize('unknown')==='en-US','Language fallback failed');
$one->plan_id=1; $one->expired_at=time()-2*86400; $assert($community->eligibility($one)==='grace','Grace period missing');
$one->expired_at=time()-4*86400; $assert($community->eligibility($one)==='expired','Expired user eligible');
echo "PASS binding ownership, identity uniqueness, grace period and eight languages\n";

// Authenticated webhook inbox, deduplication, encrypted minimum data and processing.
$req=Request::create('/api/v10/webhooks/telegram','POST');
$reject(fn()=>new App\Services\Actions\Guest\TelegramActions($req),401);
$req->headers->set('X-Telegram-Bot-Api-Secret-Token',md5(config('v2board.telegram_bot_token')));
new App\Services\Actions\Guest\TelegramActions($req); $checks++;
$delivery=new TelegramDeliveryService;
$event=['update_id'=>1,'message'=>['message_id'=>1,'chat'=>['id'=>555,'type'=>'private'],'from'=>['id'=>555,'language_code'=>'en'],'text'=>'/start','extra'=>'PRIVATE_EXTRA']];
NotificationTestCurl::$respond=fn($method,$params)=>(object)['ok'=>true,'result'=>true];
$delivery->receive($event); $delivery->receive($event);
$assert(DB::table('v2_telegram_update')->count()===1 && count(NotificationTestCurl::$calls)===0,'Webhook did synchronous network or duplicated event');
$row=DB::table('v2_telegram_update')->first();
$payload=Crypt::decryptString($row->payload);
$assert(!str_contains($row->payload,'/start') && !str_contains($payload,'PRIVATE_EXTRA'),'Inbox plaintext or excess fields');
$delivery->process($row->id); $calls=count(NotificationTestCurl::$calls); $delivery->process($row->id);
$assert(DB::table('v2_telegram_update')->value('status')==='done' && DB::table('v2_telegram_update')->value('payload')===null,'Processed inbox retained payload');
$assert(count(NotificationTestCurl::$calls)===$calls, 'Duplicate processing resent message');
$ignored=$event; $ignored['update_id']=2; $ignored['message']['text']='PRIVATE_CHAT_CONTENT'; $delivery->receive($ignored);
$assert(DB::table('v2_telegram_update')->count()===1,'Arbitrary chat body retained');
$reject(fn()=>$delivery->receive(['update_id'=>'invalid']),422);
$reject(fn()=>$delivery->receive(['update_id'=>3,'padding'=>str_repeat('x',66000)]),413);
$makeUpdate=function($id) use ($delivery,$event) { $e=$event; $e['update_id']=$id; $e['message']['chat']['id']=$id+1000; $e['message']['from']['id']=$id+1000; $delivery->receive($e); return DB::table('v2_telegram_update')->where('update_id',$id)->value('id'); };
NotificationTestCurl::$respond=fn()=>(object)['ok'=>false,'error_code'=>429,'parameters'=>(object)['retry_after'=>123]];
$id=$makeUpdate(10); $delivery->process($id); $row=DB::table('v2_telegram_update')->find($id);
$assert($row->status==='pending' && $row->attempts===1 && $row->next_at>=time()+120,'429 not deferred');
DB::table('v2_telegram_update')->where('id',$id)->update(['next_at'=>0,'attempts'=>5]); $delivery->process($id);
$assert(DB::table('v2_telegram_update')->find($id)->status==='failed','429 retries unbounded');
NotificationTestCurl::$respond=fn()=>(object)[];
$id=$makeUpdate(11); $delivery->process($id);
$assert(DB::table('v2_telegram_update')->find($id)->status==='uncertain','Unknown Telegram outcome retries');
$id=$makeUpdate(12); config(['v2board.telegram_bot_token'=>'ROTATED']); $delivery->process($id);
$assert(DB::table('v2_telegram_update')->find($id)->status==='cancelled','Old bot update processed');
config(['v2board.telegram_bot_token'=>'999999:TEST_ONLY']);
echo "PASS webhook auth, encrypted inbox, idempotency and retry boundaries\n";

// Payment notices recheck recipient and dedupe repeated callbacks.
NotificationTestCurl::$respond=fn()=>(object)['ok'=>true,'result'=>true];
$admin=User::create(['email'=>'admin@example.test','is_admin'=>1,'telegram_id'=>777,'language'=>'zh-TW']);
$order=Order::create(['user_id'=>$three->id,'trade_no'=>'TEST_ORDER','total_amount'=>32800,'paid_at'=>time(),'status'=>3]);
$tg=new TelegramService; $tg->notifyPaymentAdmins($order); $tg->notifyPaymentAdmins($order);
$assert(DB::table('v2_telegram_payment_notice')->count()===1,'Payment receipt duplicate');
$id=DB::table('v2_telegram_payment_notice')->value('id');
(new SendTelegramPaymentJob($id))->handle(); $calls=count(NotificationTestCurl::$calls); (new SendTelegramPaymentJob($id))->handle();
$assert(DB::table('v2_telegram_payment_notice')->value('status')==='sent' && $calls===count(NotificationTestCurl::$calls),'Payment sent twice');
$last=end(NotificationTestCurl::$calls); $assert($last[0]==='sendMessage' && $last[1]['chat_id']===777 && str_contains($last[1]['text'],'328.00'),'Wrong payment recipient or amount');
$order2=Order::create(['user_id'=>$three->id,'trade_no'=>'TEST_ORDER2','total_amount'=>100,'paid_at'=>time(),'status'=>3]);
$tg->notifyPaymentAdmins($order2); $admin->is_admin=0; $admin->save();
$id=DB::table('v2_telegram_payment_notice')->where('order_id',$order2->id)->value('id'); (new SendTelegramPaymentJob($id))->handle();
$assert(DB::table('v2_telegram_payment_notice')->find($id)->status==='cancelled','Revoked administrator received notice');
// Group maintenance must not unban manually banned users.
config(['v2board.telegram_group_policy_enable'=>1]);
NotificationTestCurl::$respond=function($method) {
    if ($method!=='getChatMember') throw new RuntimeException('Unexpected group mutation: '.$method);
    return (object)['ok'=>true,'result'=>(object)['status'=>'kicked']];
};
$community->observe(333); $community->reconcile(333); $checks++;
NotificationTestCurl::$respond=function($method,$params) use ($assert) {
    if ($method==='getChatMember') return (object)['ok'=>true,'result'=>(object)['status'=>'member']];
    $assert($method==='banChatMember' && $params['until_date']>=time()+115 && $params['until_date']<=time()+125, 'Policy ban not short-lived');
    return (object)['ok'=>true,'result'=>true];
};
$community->observe(888); $community->reconcile(888);
$assert(DB::table('v2_telegram_group_member')->where('telegram_id',888)->value('policy_banned')==1,'Policy ban not recorded');
echo "PASS payment dedupe, authorization recheck and manual-ban preservation\n";

if ($mysql && function_exists('pcntl_fork')) {
    // Competing processes share MySQL, but not the test's array cache.
    Schema::create('notification_test_calls', function (Blueprint $t) { $t->increments('id'); });
    $admin->is_admin=1; $admin->save();
    $order3=Order::create(['user_id'=>$three->id,'trade_no'=>'CONCURRENT_ORDER','total_amount'=>100,'paid_at'=>time(),'status'=>3]);
    $tg->notifyPaymentAdmins($order3);
    $receiptId=DB::table('v2_telegram_payment_notice')->where('order_id',$order3->id)->value('id');
    NotificationTestCurl::$respond=function($method) {
        if ($method!=='sendMessage') throw new RuntimeException('Unexpected concurrency operation');
        DB::table('notification_test_calls')->insert(['id'=>null]);
        usleep(100000);
        return (object)['ok'=>true,'result'=>true];
    };
    DB::disconnect('notification_test');
    $children=[];
    for ($i=0;$i<4;$i++) {
        $pid=pcntl_fork();
        if ($pid===-1) throw new RuntimeException('Fork failed');
        if ($pid===0) { DB::purge('notification_test'); (new SendTelegramPaymentJob($receiptId))->handle(); exit(0); }
        $children[]=$pid;
    }
    foreach ($children as $pid) { pcntl_waitpid($pid,$status); $assert(pcntl_wexitstatus($status)===0,'Concurrent child failed'); }
    DB::purge('notification_test');
    $assert(DB::table('notification_test_calls')->count()===1,'Concurrent workers sent duplicate notifications');
    $assert(DB::table('v2_telegram_payment_notice')->find($receiptId)->status==='sent','Concurrent delivery did not finish');

    echo "PASS four-process MySQL delivery claim\n";
    Schema::create('notification_test_binding', function (Blueprint $t) { $t->increments('id'); $t->integer('status'); });
    $contenders=[];
    foreach (['left','right'] as $side) {
        $account=User::create(['email'=>$side.'@example.test']); $contenders[]=$account->id;
        DB::table('v2_telegram_binding_challenge')->insert(['user_id'=>$account->id,'token_hash'=>hash('sha256',$side),'telegram_id'=>4444,'expires_at'=>time()+600]);
    }
    DB::disconnect('notification_test'); $children=[];
    foreach ($contenders as $accountId) {
        $pid=pcntl_fork(); if ($pid===-1) throw new RuntimeException('Fork failed');
        if ($pid===0) {
            DB::purge('notification_test'); $outcome=200;
            try { (new TelegramCommunityService)->confirmBinding(User::findOrFail($accountId),'4444'); }
            catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $outcome=$e->getStatusCode(); }
            DB::table('notification_test_binding')->insert(['status'=>$outcome]); exit(0);
        }
        $children[]=$pid;
    }
    foreach ($children as $pid) { pcntl_waitpid($pid,$status); $assert(pcntl_wexitstatus($status)===0,'Binding contender failed'); }
    DB::purge('notification_test');
    $assert(DB::table('notification_test_binding')->where('status',200)->count()===1 && DB::table('notification_test_binding')->where('status',409)->count()===1,'Concurrent identity claim accepted multiple accounts');
    $assert(User::where('telegram_id',4444)->count()===1 && DB::table('v2_telegram_identity')->where('telegram_id',4444)->count()===1,'Binding records diverged');
    echo "PASS competing MySQL binding confirmations\n";

}

// Scheduler classifies interrupted attempts without replaying their side effects.
$interrupted=DB::table('v2_telegram_update')->insertGetId(['bot_key'=>TelegramDeliveryService::botKey(),'update_id'=>99991,'created_at'=>time()-300,'status'=>'processing','next_at'=>time()-1,'payload'=>'PRIVATE_INTERRUPTED']);
$expired=DB::table('v2_telegram_update')->insertGetId(['bot_key'=>TelegramDeliveryService::botKey(),'update_id'=>99992,'created_at'=>time()-90000,'status'=>'pending','next_at'=>0,'payload'=>'PRIVATE_EXPIRED']);
$before=count(NotificationTestCurl::$calls);
(new App\Console\Commands\ProcessTelegramDelivery)->handle();
$assert(DB::table('v2_telegram_update')->find($interrupted)->status==='uncertain' && DB::table('v2_telegram_update')->find($interrupted)->payload===null,'Interrupted event retained or retried');
$assert(DB::table('v2_telegram_update')->find($expired)->status==='expired' && DB::table('v2_telegram_update')->find($expired)->payload===null,'Expired event processed');
$assert(count(NotificationTestCurl::$calls)===$before,'Scheduler replayed uncertain side effects');
echo "PASS interrupted-worker recovery and payload expiry\n";
require __DIR__.'/mail-cases.php';
echo "Notification delivery: $checks checks passed (".DB::connection()->getDriverName()."). No external messages sent.\n";
