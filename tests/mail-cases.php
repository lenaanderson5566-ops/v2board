<?php
namespace {
// Included by notification-delivery.php after its isolated database and transport setup.
use App\Exceptions\MailSendException;
use App\Services\{SesSender, ResendSender};
use Illuminate\Support\Facades\{Http, Crypt};

$data=app(App\Services\ProductMail::class)->data(['template_name'=>'test','language'=>'en-US']);
config(['v2board.email_from_address'=>'sender@example.test', 'v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST_SENTINEL')]);
$sender=new ResendSender;
$fakeHttp(['*'=>Http::response(['id'=>'receipt-123'],200)]);
$assert($sender->send('recipient@example.test',$data,'stable-delivery')==='receipt-123','Resend receipt missing');
Http::assertSent(fn($r)=>$r->url()==='https://api.resend.com/emails' && $r->hasHeader('Authorization','Bearer re_TEST_SENTINEL')
    && $r->hasHeader('Idempotency-Key','mail/'.hash('sha256','stable-delivery')) && $r['to']===['recipient@example.test'] && isset($r['html'],$r['text'])); $checks++;
foreach ([401=>'RESEND_AUTH_REJECTED',403=>'RESEND_AUTH_REJECTED',409=>'RESEND_IDEMPOTENCY_CONFLICT',422=>'RESEND_REQUEST_REJECTED',429=>'RESEND_RATE_LIMITED',500=>'RESEND_SERVER_UNKNOWN',302=>'RESEND_REQUEST_REJECTED'] as $status=>$code) {
    $fakeHttp(['*'=>Http::response('PRIVATE_RESPONSE', $status)]);
    try { $sender->send('recipient@example.test',$data,'stable-delivery'); throw new RuntimeException('Expected Resend rejection'); }
    catch (MailSendException $e) {
        $assert($e->safeCode===$code,'Resend status classification');
        $assert($e->retryable===($status===429) && $e->uncertain===($status===500),'Resend unsafe retries');
        $assert(!str_contains($e->getMessage(),'PRIVATE_RESPONSE'),'Resend response leaked');
    }
}
foreach ([Http::failedConnection(),Http::response(['id'=>"bad\nid"],200)] as $response) {
    $fakeHttp(['*'=>$response]);
    try { $sender->send('recipient@example.test',$data,'stable-delivery'); throw new RuntimeException('Expected uncertain Resend'); }
    catch (MailSendException $e) { $assert($e->uncertain && !$e->retryable,'Resend uncertain retried'); }
}
config(['v2board.email_provider'=>'resend']);
$fakeHttp(['*'=>Http::response(['id'=>'receipt-123'],200)]);
$job=new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']);
$copy=unserialize(serialize($job));
foreach ([$job,$copy] as $j) {
    $result=$j->handle(); $log=App\Models\MailLog::findOrFail($result['log_id']);
    $assert($log->provider==='resend' && $log->status==='accepted','Resend job routing/log failed');
}
$requests=Http::recorded();
$assert($requests[0][0]->header('Idempotency-Key')===$requests[1][0]->header('Idempotency-Key'),'Queue serialization changed idempotency key');

class TestSesSender extends SesSender {
    public array $options=[];
    public $response;
    public $command;
    protected function client(array $options): \Aws\SesV2\SesV2Client {
        $this->options=$options;
        $options['credentials']=['key'=>'TEST_ONLY','secret'=>'TEST_ONLY'];
        $options['handler']=function ($command) {
            $this->command=$command;
            if ($this->response instanceof Throwable) return \GuzzleHttp\Promise\Create::rejectionFor($this->response);
            return \GuzzleHttp\Promise\Create::promiseFor(new \Aws\Result($this->response));
        };
        return parent::client($options);
    }
}
$ses=new TestSesSender;
config(['v2board.email_ses_region'=>'ap-southeast-1','v2board.email_ses_auth'=>'role','v2board.email_ses_configuration_set'=>'delivery-events']);
$ses->response=['MessageId'=>'ses-message-123'];
$assert($ses->send('recipient@example.test',$data)==='ses-message-123','SES receipt failed');
$assert(!isset($ses->options['credentials']) && $ses->options['retries']===0,'SES role chain/retries incorrect');
$assert($ses->options['endpoint']==='https://email.ap-southeast-1.amazonaws.com' && $ses->options['http']['allow_redirects']===false,'SES endpoint not fixed');
$assert($ses->command['Destination']['ToAddresses']===['recipient@example.test'] && $ses->command['ConfigurationSetName']==='delivery-events','SES payload invalid');
$assert($ses->command['Content']['Simple']['Subject']['Charset']==='UTF-8','SES subject encoding');
config(['v2board.email_ses_auth'=>'key','v2board.email_ses_access_key'=>Crypt::encryptString('AKIA'.str_repeat('A',16)),
    'v2board.email_ses_secret_key'=>Crypt::encryptString('TEST_SECRET_SENTINEL')]);
$ses->send('recipient@example.test',$data);
$assert($ses->options['credentials']['secret']==='TEST_SECRET_SENTINEL','SES encrypted credentials failed');
foreach ([400,403,429,500,0] as $status) {
    $context=$status ? ['response'=>new \GuzzleHttp\Psr7\Response($status)] : [];
    $ses->response=new \Aws\Exception\AwsException('PRIVATE_AWS_RESPONSE',new \Aws\Command('SendEmail'),$context);
    try { $ses->send('recipient@example.test',$data); throw new RuntimeException('Expected SES rejection'); }
    catch (MailSendException $e) {
        $assert($e->retryable===($status===429) && $e->uncertain===($status===500 || !$status),'SES unsafe retries');
        $assert(!str_contains($e->getMessage(),'PRIVATE_AWS_RESPONSE'),'SES response leaked');
    }
}
$ses->response=['MessageId'=>'ses-job-receipt'];
$app->instance(SesSender::class,$ses);
config(['v2board.email_provider'=>'ses']);
$result=(new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']))->handle();
$assert(App\Models\MailLog::findOrFail($result['log_id'])->provider==='ses' && !$result['error'],'SES job routing');
foreach (['https://evil.test','us-east-1/../../','localhost'] as $region) {
    config(['v2board.email_ses_region'=>$region]);
    try { $ses->send('recipient@example.test',$data); throw new RuntimeException('Unsafe SES region accepted'); }
    catch (MailSendException $e) { $assert($e->safeCode==='SES_CONFIG_INVALID','SES invalid region classification'); }
}
config(['v2board.email_provider'=>'unknown']);
$result=(new App\Jobs\SendEmailJob(['email'=>'recipient@example.test','template_name'=>'test']))->handle();
$assert($result['error']==='MAIL_PROVIDER_INVALID','Unknown provider silently fell back to SMTP');
$rules=App\Http\Requests\Admin\ConfigSave::RULES;
foreach (['ses','resend'] as $provider) $assert(validator(['email_provider'=>$provider],['email_provider'=>$rules['email_provider']])->passes(),'Provider validation rejects supported channel');
foreach (['us-east-1','ap-southeast-1','eu-central-1'] as $region) $assert(validator(['email_ses_region'=>$region],['email_ses_region'=>$rules['email_ses_region']])->passes(),'SES region validation');
$request=Illuminate\Http\Request::create('/','GET',['key'=>'email']);
$response=(new App\Http\Controllers\V1\Admin\ConfigController)->fetch($request);
$encoded=$response->getContent();
$assert(!str_contains($encoded,'TEST_SECRET_SENTINEL') && !str_contains($encoded,'re_TEST_SENTINEL'),'Config exposed provider secrets');
$parsed=json_decode($encoded,true)['data']['email'];
foreach (['email_ses_access_key','email_ses_secret_key','email_resend_api_key'] as $field) {
    $assert($parsed[$field]==='' && !str_contains($encoded,config('v2board.'.$field)),'Encrypted credential returned in config');
}
$assert($parsed['email_ses_key_configured'] && $parsed['email_resend_key_configured'],'Configured flags missing');
foreach (['email_ses_region'=>'https://example.test','email_ses_access_key'=>'ASIA'.str_repeat('A',16),'email_resend_api_key'=>"re_test\r\nX: bad"] as $field=>$value) {
    $assert(validator([$field=>$value],[$field=>$rules[$field]])->fails(),'Unsafe credential/region accepted');
}
config(['v2board.email_ses_region'=>'us-east-1']);
$ses->response=['MessageId'=>null];
try { $ses->send('recipient@example.test',$data); throw new RuntimeException('SES malformed response accepted'); }
catch (MailSendException $e) { $assert($e->uncertain && !$e->retryable,'SES malformed response retried'); }
$invalidRequest=new class extends App\Http\Requests\Admin\ConfigSave {
    public array $testData=[];
    public function validated($key=null,$default=null) { return $this->testData; }
};
$invalidRequest->testData=['email_ses_access_key'=>'AKIA'.str_repeat('A',16)];
try { (new App\Http\Controllers\V1\Admin\ConfigController)->save($invalidRequest); throw new RuntimeException('Partial credential rotation accepted'); }
catch (Illuminate\Validation\ValidationException $e) { $checks++; }
config(['v2board.email_resend_api_key'=>null]);
$invalidRequest->testData=['email_provider'=>'resend'];
try { (new App\Http\Controllers\V1\Admin\ConfigController)->save($invalidRequest); throw new RuntimeException('Unconfigured Resend accepted'); }
catch (Illuminate\Validation\ValidationException $e) { $checks++; }
echo "PASS SES/Resend transports, queue routing, stable idempotency and safe failure handling\n";

foreach ([['Expected response code "250" but got code "550", with message "550 5.1.1 PRIVATE@example.test"',550,'5.1.1'], ['451 4.7.0 temporary',451,'4.7.0'], ['connection timed out',null,null]] as [$text,$expected,$enhanced]) {
    $assert(App\Services\MailDiagnosis::smtp(new RuntimeException($text))===[$expected,$enhanced],'SMTP response extraction failed');
}
foreach ([['5.1.1','address_review'],['5.7.1','policy'],['5.2.2','mailbox_full']] as [$enhanced,$category]) {
    $assert(App\Services\MailDiagnosis::advice('failed','SMTP_REJECTED',550,$enhanced)[0]===$category,'Unsafe recipient advice');
}
$assert(App\Services\MailDiagnosis::advice('failed','RESEND_AUTH_REJECTED',403,null)[0]==='configuration','API auth blamed recipient');
config(['v2board.email_provider'=>'resend','v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST_ONLY')]);
$fakeHttp(['*'=>Http::response([],429)]);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$receipt=App\Models\MailLog::findOrFail($result['log_id']);
$assert($receipt->transport_code===429 && $receipt->user_id==$one->id,'Response code/user association missing');
$payload=json_decode((new App\Http\Controllers\V1\Admin\MailLogController)->fetch(Illuminate\Http\Request::create('/','GET',['transport_code'=>429]))->getContent(),true);
$assert($payload['total']>0 && $payload['data'][0]['diagnosis']==='temporary','Response filtering/advice failed');
config(['v2board.email_password'=>'PRIVATE_SMTP_SECRET']);
$encoded=(new App\Http\Controllers\V1\Admin\ConfigController)->fetch(Illuminate\Http\Request::create('/','GET',['key'=>'email']))->getContent();
$assert(!str_contains($encoded,'PRIVATE_SMTP_SECRET') && json_decode($encoded,true)['data']['email']['email_smtp_key_configured'],'SMTP secret leaked');
echo "PASS transport diagnostics, recipient review and SMTP credential privacy\n";

Illuminate\Support\Facades\Mail::swap(new class { public function forgetMailers() {} public function send(...$args) {} });
config(['v2board.email_provider'=>'smtp','v2board.email_host'=>'smtp.example.test','v2board.email_password_encrypted'=>true,'v2board.email_password'=>Crypt::encryptString('SMTP_ENCRYPTED_TEST')]);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$assert(!$result['error'] && config('mail.password')==='SMTP_ENCRYPTED_TEST','Encrypted SMTP password not applied');
config(['v2board.email_password'=>'invalid-ciphertext']);
$result=(new App\Jobs\SendEmailJob(['email'=>'one@example.test','template_name'=>'test']))->handle();
$assert($result['error']==='SMTP_KEY_INVALID' && $result['permanent'],'Invalid encrypted password retried');
echo "PASS encrypted SMTP credentials and fail-closed decryption\n";
}
namespace {
use App\Services\{MailAudience,MailChannel,MailFeedback,MailWebhook,MailDeliveryLog};
use Illuminate\Support\Facades\{DB,Crypt,Http};

config(['v2board.email_password_encrypted'=>false,'v2board.email_password'=>null,'v2board.email_announcement_separate'=>0,'v2board.email_announcements_enabled'=>1,'v2board.email_provider'=>'resend','v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST'),'v2board.email_public_url'=>'https://api.example.test']);
$one=App\Models\User::create(['email'=>'audience@example.test','banned'=>0,'language'=>'en-US']);
$assert(MailAudience::blocked($one->email,'notify'),'Announcements defaulted to consent');
$assert(!MailAudience::blocked($one->email,'verify'),'Announcement opt-out blocks verification');
$one->update(['announcement_email'=>1]);
$assert(!MailAudience::blocked($one->email,'notify'),'Explicit announcement opt-in ignored');
$token=MailAudience::token($one);
$assert(MailAudience::recipient($token)->id===$one->id && !MailAudience::recipient($token.'a'),'Unsubscribe token not scoped');
$controller=new App\Http\Controllers\V10\MailController;
$controller->unsubscribe(Illuminate\Http\Request::create('/','GET'),$token);
$assert((bool)$one->fresh()->announcement_email,'GET unsubscribe changed preference');
$controller->unsubscribe(Illuminate\Http\Request::create('/','POST',['List-Unsubscribe'=>'One-Click']),$token);
$assert(!$one->fresh()->announcement_email,'One-click unsubscribe failed');
$controller->unsubscribe(Illuminate\Http\Request::create('/','POST',['List-Unsubscribe'=>'One-Click']),$token); $checks++;
$one->update(['announcement_email'=>1]);
$data=app(App\Services\ProductMail::class)->data(['email'=>$one->email,'template_name'=>'notify','subject'=>'Announcement','template_value'=>['content'=>'Hello']]);
$data=MailAudience::withUnsubscribe($one->email,$data);
$assert(str_starts_with($data['unsubscribeUrl'],'https://api.example.test/api/v10/mail/unsubscribe/'),'Wrong unsubscribe origin');
$fakeHttp(['*'=>Http::response(['id'=>'announcement-1'],200)]);
(new App\Services\ResendSender)->send($one->email,$data,'announcement-test');
Http::assertSent(fn($r)=>$r['headers']['List-Unsubscribe-Post']==='List-Unsubscribe=One-Click' && str_contains($r['text'],$data['unsubscribeUrl'])); $checks++;
config(['v2board.email_announcement_separate'=>1,'v2board.email_announcement_provider'=>'mailgun','v2board.email_announcement_from_address'=>'news@news.example.test']);
$before=config('v2board');
try { MailChannel::run(true,function() use($assert) { $assert(config('v2board.email_provider')==='mailgun' && config('v2board.email_from_address')==='news@news.example.test','Announcement channel not selected'); throw new RuntimeException('test'); }); } catch (RuntimeException $e) {}
$assert(config('v2board')===$before,'Long-lived worker retained announcement credentials');
$called=false; MailChannel::run(false,function() use(&$called) {$called=config('v2board.email_provider')==='resend';}); $assert($called,'Transactional stream overridden');
config(['v2board.email_announcement_separate'=>0]);
$job=new App\Jobs\SendEmailJob(['email'=>$one->email,'template_name'=>'notify']);
$one->update(['announcement_email'=>0]); $assert(($job->handle()['skipped'] ?? false),'Queued announcement ignored later opt-out');
$one->update(['announcement_email'=>1]);

config(['v2board.email_announcement_separate'=>1,'v2board.email_announcement_provider'=>'mailgun','v2board.email_announcement_mailgun_domain'=>'news.example.test','v2board.email_announcement_mailgun_api_key'=>Crypt::encryptString('TEST_ONLY')]);
$fakeHttp(['*'=>Http::response(['id'=>'<announcement-queue>'],200)]);
$before=config('v2board');
$result=(new App\Jobs\SendEmailJob(['email'=>$one->email,'template_name'=>'notify','template_value'=>['content'=>'Announcement']],'send_email_mass'))->handle();
$assert(empty($result['error']) && config('v2board')===$before,'Announcement queue failed/restoration failed');
Http::assertSent(function($r) { $fields=array_column($r->data(),'contents','name'); return str_contains($fields['from'],'news@news.example.test') && $fields['h:List-Unsubscribe-Post']==='List-Unsubscribe=One-Click'; }); $checks++;
config(['v2board.email_announcement_separate'=>0]);

// Signed Resend event, recipient/message binding, dedupe, out-of-order, suppression.
$secret=str_repeat('x',32); config(['v2board.email_resend_webhook_key'=>Crypt::encryptString('whsec_'.base64_encode($secret))]);
$sign=function(array $body,string $id='msg_test',int $at=0) use($secret) {
    $at=$at ?: time(); $raw=json_encode($body,JSON_UNESCAPED_SLASHES);
    $r=Illuminate\Http\Request::create('/api/v10/webhooks/mail/resend','POST',[],[],[],['CONTENT_TYPE'=>'application/json'],$raw);
    $r->headers->set('svix-id',$id); $r->headers->set('svix-timestamp',(string)$at);
    $r->headers->set('svix-signature','v1,'.base64_encode(hash_hmac('sha256',$id.'.'.$at.'.'.$raw,$secret,true))); return $r;
};
$body=['type'=>'email.bounced','created_at'=>gmdate('c'),'data'=>['email_id'=>'feedback-1','to'=>[$one->email],'bounce'=>['type'=>'Permanent']]];
$webhook=new MailWebhook;
$webhook->receive('resend',$sign($body));
$assert(!MailAudience::blocked($one->email,'verify'),'Unmatched event suppressed user');
$receipt=MailDeliveryLog::begin($one->email,'notify','resend','announcement');
MailDeliveryLog::finish($receipt,'accepted',null,'feedback-1',1);
$assert($receipt->fresh()->delivery_status==='bounced' && MailAudience::blocked($one->email,'verify'),'Early bounce not reconciled');
$webhook->receive('resend',$sign($body));
$assert(DB::table('v2_mail_event')->where('provider','resend')->count()===1,'Duplicate event not deduped');
$delivered=$body; $delivered['type']='email.delivered';
$webhook->receive('resend',$sign($delivered,'msg_delivered'));
$assert($receipt->fresh()->delivery_status==='bounced','Late delivered event erased bounce');
$bad=$sign($body); $bad->headers->set('svix-signature','v1,invalid'); $reject(fn()=>$webhook->receive('resend',$bad),403);
$reject(fn()=>$webhook->receive('resend',$sign($body,'msg_stale',time()-600)),403);
$fake=$body; $fake['data']['to']=['stranger@example.test']; $webhook->receive('resend',$sign($fake,'msg_wrong_recipient'));
$assert(!MailAudience::blocked('stranger@example.test','verify'),'Unrelated recipient suppressed');
$logController=new App\Http\Controllers\V1\Admin\MailLogController;
$release=Illuminate\Http\Request::create('/','POST',['recipient_hash'=>MailDeliveryLog::recipientHash($one->email),'verified'=>true]);
$logController->release($release);
$webhook->receive('resend',$sign($body));
$assert(!MailAudience::blocked($one->email,'verify'),'Replay reactivated reviewed suppression');
$complaint=$body; $complaint['type']='email.complained'; $complaint['created_at']=gmdate('c',time()+1);
$webhook->receive('resend',$sign($complaint,'msg_complaint'));
$assert($receipt->fresh()->delivery_status==='complained' && MailAudience::blocked($one->email,'verify'),'Complaint ignored');
$reject(fn()=>$logController->release($release),422);

// Mailgun HMAC and enhanced code classification, no provider body storage.
config(['v2board.email_mailgun_webhook_key'=>Crypt::encryptString('MAILGUN_SIGNING_TEST')]);
$mg=['signature'=>['timestamp'=>(string)time(),'token'=>str_repeat('a',32)],'event-data'=>['event'=>'failed','severity'=>'permanent','timestamp'=>time(),'recipient'=>'mg@example.test','message'=>['headers'=>['message-id'=>'mg-message']],'delivery-status'=>['enhanced-code'=>'5.7.1','message'=>'PRIVATE_BODY']]];
$mg['signature']['signature']=hash_hmac('sha256',$mg['signature']['timestamp'].$mg['signature']['token'],'MAILGUN_SIGNING_TEST');
$mgReceipt=MailDeliveryLog::begin('mg@example.test','notify','mailgun','announcement');MailDeliveryLog::finish($mgReceipt,'accepted',null,'<mg-message>',1);
$mgRequest=fn($payload)=>Illuminate\Http\Request::create('/','POST',[],[],[],['CONTENT_TYPE'=>'application/json'],json_encode($payload));
$webhook->receive('mailgun',$mgRequest($mg));
$assert($mgReceipt->fresh()->delivery_status==='rejected' && !MailAudience::blocked('mg@example.test','verify'),'Policy rejection treated as bad recipient');
$assert(!str_contains(json_encode(DB::table('v2_mail_event')->get()),'PRIVATE_BODY'),'Raw provider payload persisted');
$mg['signature']['signature']='bad';$reject(fn()=>$webhook->receive('mailgun',$mgRequest($mg)),403);

// SNS signature verification uses locally generated cert and fake HTTPS only.
$topic='arn:aws:sns:us-east-1:123456789012:mail-events';config(['v2board.email_ses_topic_arn'=>$topic]);
$key=openssl_pkey_new(['private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA]);
$csr=openssl_csr_new(['commonName'=>'sns.us-east-1.amazonaws.com'],$key);$cert=openssl_csr_sign($csr,null,$key,1);openssl_x509_export($cert,$pem);
$certUrl='https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem';
$fakeHttp([$certUrl=>Http::response($pem,200)]);
$event=['notificationType'=>'Delivery','mail'=>['messageId'=>'ses-feedback'],'delivery'=>['recipients'=>['ses@example.test'],'timestamp'=>gmdate('c')]];
$sns=['Type'=>'Notification','MessageId'=>'sns-event-1','TopicArn'=>$topic,'Message'=>json_encode($event),'Timestamp'=>gmdate('c'),'SignatureVersion'=>'2','SigningCertURL'=>$certUrl];
$snsSign=function(array $body) use($key) {
    $fields=$body['Type']==='Notification' ? ['Message','MessageId','Subject','Timestamp','TopicArn','Type'] : ['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];
    $signed=''; foreach($fields as $field) if (isset($body[$field])) $signed.=$field."\n".$body[$field]."\n";
    openssl_sign($signed,$signature,$key,OPENSSL_ALGO_SHA256);$body['Signature']=base64_encode($signature);return $body;
};
$sesReceipt=MailDeliveryLog::begin('ses@example.test','test','ses');MailDeliveryLog::finish($sesReceipt,'accepted',null,'ses-feedback',1);
$webhook->receive('ses',$mgRequest($snsSign($sns)));
$assert($sesReceipt->fresh()->delivery_status==='delivered','SNS signature/normalization failed');
$evil=$snsSign($sns);$evil['Message']='{}';$reject(fn()=>$webhook->receive('ses',$mgRequest($evil)),403);
$evil=$snsSign($sns);$evil['SigningCertURL']='https://127.0.0.1/cert.pem';$reject(fn()=>$webhook->receive('ses',$mgRequest($evil)),403);
$evil=$snsSign($sns);$evil['TopicArn']='arn:aws:sns:us-east-1:999999999999:mail-events';$reject(fn()=>$webhook->receive('ses',$mgRequest($evil)),403);
$assert(DB::table('v2_mail_event')->where('provider','ses')->count()===1,'Rejected SNS wrote event');

// Save actual config via fake filesystem; ensure encryption marker is persisted, no plaintext output.
$fileRoot=Illuminate\Support\Facades\File::getFacadeRoot();$artisanRoot=Illuminate\Support\Facades\Artisan::getFacadeRoot();$savedConfig='';
Illuminate\Support\Facades\File::shouldReceive('put')->once()->andReturnUsing(function($path,$content) use(&$savedConfig) {$savedConfig=$content;return strlen($content);});
Illuminate\Support\Facades\Artisan::shouldReceive('call')->with('config:cache')->once()->andReturn(0);
$saveRequest=new class extends App\Http\Requests\Admin\ConfigSave { public function validated($key=null,$default=null) {return ['email_provider'=>'smtp','email_password'=>'NEW_SMTP_PRIVATE'];} };
(new App\Http\Controllers\V1\Admin\ConfigController)->save($saveRequest);
$assert(str_contains($savedConfig,"'email_password_encrypted' => true") && !str_contains($savedConfig,'NEW_SMTP_PRIVATE'),'SMTP encryption marker not saved');
Illuminate\Support\Facades\File::swap($fileRoot);Illuminate\Support\Facades\Artisan::swap($artisanRoot);
$assert(isset(App\Http\Requests\Admin\ConfigSave::allRules()['email_announcement_provider']),'Announcement config not validated');
echo "PASS mail streams, opt-in, unsubscribe, signed feedback, dedupe, SSRF rejection and suppression review\n";

if ($mysql && function_exists('pcntl_fork')) {
    $parallel=MailDeliveryLog::begin('parallel-mail@example.test','test','resend');MailDeliveryLog::finish($parallel,'accepted',null,'parallel-mail-receipt',1);
    DB::disconnect('notification_test');$children=[];
    for($i=0;$i<2;$i++) {
        $pid=pcntl_fork(); if ($pid===-1) throw new RuntimeException('Fork failed');
        if ($pid===0) { DB::purge('notification_test');(new MailFeedback)->record('resend','parallel-event','parallel-mail-receipt','parallel-mail@example.test','complained',time());exit(0); }
        $children[]=$pid;
    }
    foreach($children as $pid) { pcntl_waitpid($pid,$status);$assert(pcntl_wexitstatus($status)===0,'Concurrent mail feedback failed'); }
    DB::purge('notification_test');
    $assert(DB::table('v2_mail_event')->where('message_id','parallel-mail-receipt')->count()===1 && MailAudience::blocked('parallel-mail@example.test','verify'),'Concurrent feedback dedupe failed');
    echo "PASS concurrent MySQL mail feedback ingestion\n";
}

$contract=App\Http\Resources\V10\Resource::contracts()['endpoints']['patchMe'];
App\Http\Requests\V10\Input::validate(Illuminate\Http\Request::create('/','PATCH',['announcementEmails'=>true]),$contract); $checks++;
try {App\Http\Requests\V10\Input::validate(Illuminate\Http\Request::create('/','PATCH',['announcementEmails'=>'invalid']),$contract);throw new RuntimeException('Invalid preference accepted');}
catch (Illuminate\Validation\ValidationException $e) {$checks++;}
$account=App\Http\Resources\V10\Resource::encode('account',['announcement_email'=>1]);
$assert($account['announcementEmails']===true,'Preference resource is not boolean');

// Unmatched provider events must not fill the recovery batch ahead of local receipts.
$pendingReceipt=MailDeliveryLog::begin('recover@example.test','test','resend');
(new MailFeedback)->record('resend','recover-event','recover-receipt','recover@example.test','delivered',time());
$pendingReceipt->update(['message_id'=>'<recover-receipt>']);
app(App\Console\Commands\ProcessMailFeedback::class)->handle();
$assert($pendingReceipt->fresh()->delivery_status==='delivered','Scheduled feedback recovery failed');
}
namespace {
use App\Services\MailCampaign;
use App\Jobs\SendCampaignMailJob;
use Illuminate\Support\Facades\{DB,Http,Crypt,Schema};
$serviceUser=App\Models\User::create(['email'=>'campaign@example.test','banned'=>0,'announcement_email'=>0]);
$q=App\Models\User::where('id',$serviceUser->id);
$assert(MailCampaign::preview($q,'service')['eligible']===1 && MailCampaign::preview($q,'marketing')['not_subscribed']===1,'Service/marketing eligibility conflated');
$data=['request_key'=>(string)Illuminate\Support\Str::uuid(),'purpose'=>'service','subject'=>'Maintenance','content'=>'Service maintenance content','translations'=>[]];
$campaign=MailCampaign::create($q,$data,1);
$recipient=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$campaign)->first();
config(['v2board.email_provider'=>'resend','v2board.email_from_address'=>'service@example.test','v2board.email_resend_api_key'=>Crypt::encryptString('re_TEST'),'v2board.email_announcement_separate'=>1,'v2board.email_announcements_enabled'=>0]);
$fakeHttp(['*'=>Http::response(['id'=>'campaign-message'],200)]);
(new SendCampaignMailJob($recipient->id))->handle();
$sent=DB::table('v2_mail_campaign_recipient')->find($recipient->id);
$assert($sent->status==='accepted','Necessary service notice blocked by marketing preference');
Http::assertSent(fn($r)=>!isset($r['headers']['List-Unsubscribe']) && str_contains($r['from'],'service@example.test'));$checks++;
(new SendCampaignMailJob($recipient->id))->handle();Http::assertSentCount(1);$checks++;
$assert(MailCampaign::stats($campaign)['delivery_rate']===0.0,'Campaign acceptance denominator incorrect');
(new App\Services\MailFeedback)->record('resend','campaign-delivered','campaign-message',$serviceUser->email,'delivered',time());
$assert(MailCampaign::stats($campaign)['delivered']===1 && MailCampaign::stats($campaign)['delivery_rate']===100.0,'Campaign callback statistics missing');
$assert(MailCampaign::create($q,$data,1)===$campaign,'Repeated submission created duplicate campaign');
$data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='marketing';$marketing=MailCampaign::create($q,$data,1);
$assert(MailCampaign::stats($marketing)['skipped']===1,'Marketing silently enrolled unsubscribed users');
$data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='service';$changed=MailCampaign::create($q,$data,1);$r=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$changed)->first();$serviceUser->update(['email'=>'changed@example.test']);
(new SendCampaignMailJob($r->id))->handle();$assert(DB::table('v2_mail_campaign_recipient')->find($r->id)->reason==='recipient_changed','Campaign followed changed recipient address');
DB::table('v2_mail_campaign_recipient')->where('id',$r->id)->update(['status'=>'sending','updated_at'=>time()-700]);
(new App\Console\Commands\ProcessMailCampaigns)->handle();$assert(DB::table('v2_mail_campaign_recipient')->find($r->id)->status==='uncertain','Interrupted campaign automatically replayed');
// Private ticket replies are merged per ticket, with owner-scoped versioned read receipts.
Schema::create('v2_ticket',function($t){$t->bigIncrements('id');$t->unsignedBigInteger('user_id');});
Schema::create('v2_ticket_message',function($t){$t->bigIncrements('id');$t->unsignedBigInteger('ticket_id');$t->unsignedBigInteger('user_id');$t->unsignedInteger('created_at');});
$ticket=DB::table('v2_ticket')->insertGetId(['user_id'=>$serviceUser->id]);
$mine=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>$serviceUser->id,'created_at'=>time()]);
$otherTicket=DB::table('v2_ticket')->insertGetId(['user_id'=>999999]);
DB::table('v2_ticket_message')->insert(['ticket_id'=>$otherTicket,'user_id'=>1,'created_at'=>time()]);
$action=new App\Services\Actions\User\TicketNotificationActions;
$assert($action->inbox($serviceUser->id)['unread']===0,'Other users ticket or own message leaked into inbox');
$reply=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>1,'created_at'=>time()]);
$reply2=DB::table('v2_ticket_message')->insertGetId(['ticket_id'=>$ticket,'user_id'=>1,'created_at'=>time()]);
$assert($action->inbox($serviceUser->id)['unread']===1 && $action->inbox($serviceUser->id)['items'][0]['message_id']===$reply2,'Ticket replies not coalesced');
$req=fn($id,$version)=>Illuminate\Http\Request::create('/','POST',['id'=>$id,'version'=>$version,'user'=>['id'=>$serviceUser->id]]);
$reject(fn()=>$action->read($req($otherTicket,$reply)),404);
$reject(fn()=>$action->read($req($ticket,$mine)),422);
$action->read($req($ticket,$reply));$assert($action->inbox($serviceUser->id)['unread']===1,'Old read acknowledged newer reply');
$action->read($req($ticket,$reply2));$action->read($req($ticket,$reply));$assert($action->inbox($serviceUser->id)['unread']===0,'Read receipt regressed');
$assert(DB::table('v2_ticket_notification_read')->count()===1,'Read receipt not idempotent');
echo "PASS campaign purpose, recipient dedupe, feedback stats, interruption recovery and private ticket receipts\n";

// Concurrent queue duplicates must claim a recipient only once.
if($mysql && function_exists('pcntl_fork')) {
 $data['request_key']=(string)Illuminate\Support\Str::uuid();$data['purpose']='service';$parallelId=MailCampaign::create($q,$data,1);
 $parallelRecipient=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$parallelId)->first();
 $before=DB::table('v2_mail_log')->count();$fakeHttp(['*'=>Http::response(['id'=>'parallel-campaign'],200)]);
 DB::disconnect('notification_test');$children=[];
 for($i=0;$i<2;$i++) { $pid=pcntl_fork();if($pid===-1)throw new RuntimeException('Fork failed');if($pid===0){DB::purge('notification_test');(new SendCampaignMailJob($parallelRecipient->id))->handle();exit(0);}$children[]=$pid; }
 foreach($children as $pid){pcntl_waitpid($pid,$status);$assert(pcntl_wexitstatus($status)===0,'Campaign contender failed');}
 DB::purge('notification_test');
 $assert(DB::table('v2_mail_log')->count()===$before+1 && DB::table('v2_mail_campaign_recipient')->find($parallelRecipient->id)->status==='accepted','Concurrent campaign duplicate sent more than once');
 echo "PASS concurrent MySQL campaign recipient claim\n";
}
}
namespace {
use App\Services\{MailBlocklist,MailAudience,MailCampaign,MailDeliveryLog};
use Illuminate\Support\Facades\{DB,Http,Crypt,Mail};
$address='manual-block@example.test';$note='<script>private note</script>';
MailBlocklist::add(' Manual-Block@Example.Test ',$note,1);
$hash=MailDeliveryLog::recipientHash($address);
$row=DB::table('v2_mail_blocklist')->where('recipient_hash',$hash)->first();
$assert(MailBlocklist::contains('MANUAL-BLOCK@example.test') && MailAudience::blocked($address,'verify'),'Manual block ignored');
$assert(!str_contains($row->email_encrypted,$address) && Crypt::decryptString($row->email_encrypted)===$address,'Address stored unencrypted');
$reject(fn()=>MailBlocklist::add($address,'duplicate',2),409);
$controller=new App\Http\Controllers\V1\Admin\MailBlocklistController;
$list=$controller->fetch(Illuminate\Http\Request::create('/','GET',['email'=>$address]));
$body=json_decode($list->getContent(),true);
$assert($body['total']===1 && $body['data'][0]['note']===$note && !isset($body['data'][0]['email_encrypted']),'Admin list or privacy fields incorrect');
$assert($list->headers->get('Cache-Control')==='no-store, private','Sensitive list is cacheable');
$fakeHttp();$blockedMail=new class {public int $calls=0;public function forgetMailers(){} public function send(...$args){$this->calls++;throw new RuntimeException('Unexpected SMTP send');}};Mail::swap($blockedMail);
foreach(['smtp','mailgun','ses','resend'] as $provider){
 config(['v2board.email_provider'=>$provider,'v2board.email_announcement_separate'=>0]);
 foreach(App\Services\ProductMail::TYPES as $type){
  $result=(new App\Jobs\SendEmailJob(['email'=>$address,'template_name'=>$type]))->handle();
  $assert(!empty($result['skipped']) && $result['reason']==='manual_blocklist','Mail type bypassed block: '.$provider.'/'.$type);
  $log=App\Models\MailLog::find($result['log_id']);
  $assert($log->status==='skipped' && $log->error_code==='MAIL_MANUALLY_BLOCKED' && $log->subject==='' && !$log->message_id,'Blocked mail marked accepted or leaked content');
 }
}
Http::assertNothingSent();$checks++;$assert($blockedMail->calls===0,'Blocked SMTP reached transport');
foreach([new App\Services\MailgunSender,new App\Services\SesSender,new App\Services\ResendSender] as $sender){
 try{$sender->send($address,[],'test');throw new RuntimeException('Direct sender bypassed block');}
 catch(App\Exceptions\MailSendException $e){$assert($e->safeCode==='MAIL_MANUALLY_BLOCKED','Wrong direct sender rejection');}
}
$account=App\Models\User::create(['email'=>$address,'banned'=>0,'announcement_email'=>1]);
$q=App\Models\User::where('id',$account->id);
$assert(MailCampaign::preview($q,'service')['manual_blocklist']===1 && MailCampaign::preview($q,'marketing')['eligible']===0,'Campaign preview ignored block');
$assert(!$account->fresh()->banned,'Mail restriction banned account');
MailBlocklist::change($hash,1,'note','reviewed note',2);
$reject(fn()=>MailBlocklist::change($hash,1,'release',null,1),409);
DB::table('v2_mail_suppression')->insert(['recipient_hash'=>$hash,'email'=>MailDeliveryLog::mask($address),'reason'=>'bounced','created_at'=>time(),'updated_at'=>time()]);
MailBlocklist::change($hash,2,'release',null,1);
$assert(!MailBlocklist::contains($address) && MailAudience::blocked($address,'verify'),'Manual release removed automatic suppression');
MailBlocklist::add($address,'reopen',1);
$assert(MailBlocklist::contains($address),'Reactivation failed');
$autoRequest=Illuminate\Http\Request::create('/','POST',['recipient_hash'=>$hash,'verified'=>true,'user'=>['id'=>1]]);
(new App\Http\Controllers\V1\Admin\MailLogController)->release($autoRequest);
$assert(MailAudience::blocked($address,'test'),'Automatic release removed manual block');
$assert(DB::table('v2_mail_blocklist_audit')->where('recipient_hash',$hash)->count()===4,'Audit history missing or duplicate');
$assert(!str_contains(json_encode(DB::table('v2_mail_blocklist_audit')->get()),$note),'Private note in audit metadata');
$logController=new App\Http\Controllers\V1\Admin\MailLogController;
$logs=json_decode($logController->fetch(Illuminate\Http\Request::create('/','GET',['status'=>'skipped','email'=>$address]))->getContent(),true);
$assert($logs['total']===count(App\Services\ProductMail::TYPES)*4,'Blocked log filtering failed');
echo "PASS manual mail blocklist, all mail types/providers, encrypted address, audit, concurrency revisions and independent release\n";

$lateAddress='queued-before-block@example.test';
$queuedBeforeBlock=new App\Jobs\SendEmailJob(['email'=>$lateAddress,'template_name'=>'test']);
MailBlocklist::add($lateAddress,'added after queueing',1);
$assert(($queuedBeforeBlock->handle()['reason'] ?? null)==='manual_blocklist','Previously queued mail bypassed current blocklist');
MailBlocklist::change($hash,4,'release',null,1);
$assert(!MailAudience::blocked($address,'test'),'Independent restrictions not released correctly');
Http::assertNothingSent();$checks++;
}
