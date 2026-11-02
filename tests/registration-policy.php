<?php
$app = require __DIR__.'/support/bootstrap.php';
use App\Utils\Helper;
use App\Models\User;
use App\Models\EmailInvitation;
use App\Services\EmailInvitationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
if(!app()->environment('local'))throw new RuntimeException('Local tests only');
$checks=0;$assert = \Tests\Support\Assertions::counter($checks);
$reject=function($action)use($assert){try{$action();throw new RuntimeException('Unexpected success');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert(in_array($e->getStatusCode(),[422,500]),'Wrong rejection');}};
$assert(Helper::emailSuffixes('[" QQ.COM ","@gmail.com","qq.com"]')===['qq.com','gmail.com'],'Normalization failed');
$assert(Helper::emailSuffixVerify('Name@QQ.COM',' qq.com , gmail.com '),'Case insensitive match failed');
$assert(!Helper::emailSuffixVerify('x@evil.qq.com',['qq.com']),'Subdomain bypass');
$assert(!Helper::emailSuffixVerify('x@evilqq.com',['qq.com']),'Partial domain bypass');
$assert(!Helper::emailSuffixVerify('x@y@qq.com',['qq.com']),'Malformed email accepted');
$original=config('v2board');Queue::fake();DB::beginTransaction();
$emails=['policy-new@example.test','policy-existing@legacy.test'];
try{
 config(['v2board.invite_force'=>1,'v2board.email_whitelist_enable'=>1,'v2board.email_whitelist_suffix'=>' Example.Test ','v2board.stop_register'=>0,'v2board.email_gmail_limit_enable'=>0]);
 $owner=User::create(['email'=>'policy-owner@example.test','password'=>'test','uuid'=>Helper::guid(true),'token'=>Helper::guid(),'banned'=>0]);
 User::create(['email'=>$emails[1],'password'=>'test','uuid'=>Helper::guid(true),'token'=>Helper::guid()]);
 $token=str_repeat('a',64);$inv=EmailInvitation::create(['user_id'=>$owner->id,'email'=>$emails[0],'email_hash'=>hash('sha256',$emails[0]),'token_hash'=>hash('sha256',$token),'expires_at'=>time()+3600,'last_requested_at'=>time()]);
 $service=new EmailInvitationService;
 $assert($service->validateRecipient($token,strtoupper($emails[0]))->id===$inv->id,'Bound invitation check failed');
 $assert(!$inv->fresh()->accepted_at,'Preview consumed invitation');
 $reject(fn()=>$service->validateRecipient($token,'other@example.test'));
 $reject(fn()=>$service->send($owner->id,'outside@legacy.test'));
 $controller=new App\Http\Controllers\V1\Passport\CommController;
 $send=function($body)use($controller){RateLimiter::clear('127.0.0.1');$r=App\Http\Requests\Passport\CommSendEmailVerify::create('/','POST',$body);return $controller->sendEmailVerify($r);};
 $reject(fn()=>$send(['email'=>$emails[0],'isforget'=>0]));
 $reject(fn()=>$send(['email'=>$emails[0],'isforget'=>0,'invitation'=>str_repeat('b',64)]));
 $assert(Queue::pushed(App\Jobs\SendEmailJob::class)->count()===0,'Rejected registrations queued OTP');
 $send(['email'=>$emails[0],'isforget'=>0,'invitation'=>$token]);
 $assert(Queue::pushed(App\Jobs\SendEmailJob::class)->count()===1,'Valid invitation OTP missing');
 $assert(!$inv->fresh()->accepted_at,'OTP consumed invitation');
 config(['v2board.stop_register'=>1]);$send(['email'=>$emails[1],'isforget'=>1]);
 $assert(Queue::pushed(App\Jobs\SendEmailJob::class)->count()===2,'Existing account recovery blocked');
 $reject(fn()=>$send(['email'=>'policy-boolean-purpose@example.test','isforget'=>true]));
 $assert(Queue::pushed(App\Jobs\SendEmailJob::class)->count()===2,'Boolean recovery purpose bypassed registration policy for an unknown account');
 $guest=(new App\Services\Actions\Guest\CommActions)->config()->getOriginalContent()['data'];
 $assert($guest['email_whitelist_suffix']===['example.test']&&$guest['is_invite_force']===1,'Guest configuration differs from policy');
 // Registration OTP guesses must share an email-bound budget across spelling
 // and IP changes. A new code or another purpose cannot reset that budget.
 config(['v2board.invite_force'=>0,'v2board.email_whitelist_enable'=>0,'v2board.stop_register'=>0,'v2board.email_verify'=>1,
  'v2board.register_limit_by_ip_enable'=>0,'v2board.try_out_plan_id'=>0,'v2board.mfa_enable'=>0]);
 $kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);$attemptIp=40;
 $invoke=function(string $path,array $body)use($app,$kernel,&$attemptIp){
  $r=Illuminate\Http\Request::create('/api/v10/auth/'.$path,'POST',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','REMOTE_ADDR'=>'203.0.113.'.(++$attemptIp)],json_encode($body));
  $app->instance('request',$r);return $kernel->handle($r);
 };
 $lastCode=function(){
  $job=Queue::pushed(App\Jobs\SendEmailJob::class)->last();
  return (new ReflectionProperty($job,'params'))->getValue($job)['template_value']['code'];
 };
 $guessed='registration-budget-'.bin2hex(random_bytes(6)).'@example.test';$emails[]=$guessed;
 $assert($invoke('email-verifications',['email'=>$guessed,'resetPassword'=>false])->getStatusCode()===202,'Open registration queues a real verification code');
 $correct=$lastCode();$statuses=[];
 for($guess=0;$guess<6;$guess++) {
  $failedRegistration=$invoke('registrations',['email'=>$guess%2?strtoupper($guessed):$guessed,'password'=>'RegistrationBudget!2026','emailCode'=>'000000']);
  $statuses[]=$failedRegistration->getStatusCode();
 }
 $afterLimit=$invoke('registrations',['email'=>strtoupper($guessed),'password'=>'RegistrationBudget!2026','emailCode'=>$correct]);
 $created=User::where('email',$guessed)->exists();
 $assert(array_slice($statuses,0,5)===[409,409,409,409,409] && $statuses[5]===429 && $afterLimit->getStatusCode()===429 && !$created,
  'Registration guessing lock missing: sixth='.$statuses[5].', correct='.$afterLimit->getStatusCode().', created='.($created?'yes':'no'));
 $assert((int)$failedRegistration->headers->get('Retry-After')>0 && (int)$afterLimit->headers->get('Retry-After')>0,'Exhausted registration challenges include a positive retry delay for client recovery');
 Cache::forget(App\Utils\CacheKey::get('LAST_SEND_EMAIL_VERIFY_TIMESTAMP',$guessed));
 $resend=$invoke('email-verifications',['email'=>strtoupper($guessed),'resetPassword'=>false]);
 $assert(in_array($resend->getStatusCode(),[202,429],true),'Resending an exhausted challenge remains a defined queued or throttled response');
 $resentCode=$resend->getStatusCode()===202?$lastCode():$correct;
 $afterResend=$invoke('registrations',['email'=>$guessed,'password'=>'RegistrationBudget!2026','emailCode'=>$resentCode]);
 $assert($afterResend->getStatusCode()===429 && (int)$afterResend->headers->get('Retry-After')>0
  && !User::where('email',$guessed)->exists(),'Resending a code cannot erase the email guess budget or its retry guidance');
 $ordinary='registration-valid-'.bin2hex(random_bytes(6)).'@example.test';$emails[]=$ordinary;
 $assert($invoke('email-verifications',['email'=>$ordinary,'resetPassword'=>false])->getStatusCode()===202,'Another email keeps an independent verification budget');
 $ordinaryCode=$lastCode();
 $normal=$invoke('registrations',['email'=>$ordinary,'password'=>'RegistrationBudget!2026','emailCode'=>$ordinaryCode]);
 $assert($normal->getStatusCode()===201 && User::where('email',$ordinary)->exists(),'A fresh email can still register normally with the correct code');
 $recoveryUser=User::create(['email'=>$guessed,'password'=>password_hash('BeforeRecovery!2026',PASSWORD_DEFAULT),'uuid'=>Helper::guid(true),'token'=>Helper::guid()]);
 $assert($invoke('email-verifications',['email'=>$guessed,'resetPassword'=>true])->getStatusCode()===202,'Registration guess exhaustion does not lock the separate recovery purpose');
 $recoveryCode=$lastCode();
 $assert($invoke('password-resets',['email'=>$guessed,'password'=>'AfterRecovery!2026','emailCode'=>$recoveryCode])->getStatusCode()===204
  && password_verify('AfterRecovery!2026',$recoveryUser->fresh()->password),'Purpose-bound account recovery still consumes its own valid challenge');
}finally{
 foreach(User::whereIn('email',$emails)->get() as $account){
  (new App\Services\AuthService($account))->removeAllSession();
  $key=App\Services\PasswordRecovery::challengeKey((int)$account->id);foreach([$key,$key.':sent',$key.':attempts'] as $cacheKey)Cache::forget($cacheKey);
 }
 DB::rollBack();config(['v2board'=>$original]);RateLimiter::clear('127.0.0.1');foreach($emails as $email){
  Cache::forget(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$email));Cache::forget(App\Utils\CacheKey::get('LAST_SEND_EMAIL_VERIFY_TIMESTAMP',$email));
  if(class_exists(App\Services\RegistrationEmailVerification::class))RateLimiter::clear(App\Services\RegistrationEmailVerification::attemptKey($email));
 }
}
echo "PASS: $checks registration policy checks\n";
