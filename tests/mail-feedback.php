<?php
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
