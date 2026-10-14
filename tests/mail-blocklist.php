<?php
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
