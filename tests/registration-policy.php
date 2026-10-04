<?php
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use App\Utils\Helper;
use App\Models\User;
use App\Models\EmailInvitation;
use App\Services\EmailInvitationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
if(!app()->environment('local'))throw new RuntimeException('Local tests only');
$checks=0;$assert=function($ok,$msg)use(&$checks){if(!$ok)throw new RuntimeException($msg);$checks++;};
$reject=function($action)use($assert){try{$action();throw new RuntimeException('Unexpected success');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert(in_array($e->getStatusCode(),[422,500]),'Wrong rejection');}};
$assert(Helper::emailSuffixes('[" QQ.COM ","@gmail.com","qq.com"]')===['qq.com','gmail.com'],'Normalization failed');
$assert(Helper::emailSuffixVerify('Name@QQ.COM',' qq.com , gmail.com '),'Case insensitive match failed');
$assert(!Helper::emailSuffixVerify('x@evil.qq.com',['qq.com']),'Subdomain bypass');
$assert(!Helper::emailSuffixVerify('x@evilqq.com',['qq.com']),'Partial domain bypass');
$assert(!Helper::emailSuffixVerify('x@y@qq.com',['qq.com']),'Malformed email accepted');
$original=config('v2board');Queue::fake();DB::beginTransaction();
$emails=['policy-new@example.test','policy-existing@legacy.test'];
try{
 config(['v2board.invite_force'=>1,'v2board.email_whitelist_enable'=>1,'v2board.email_whitelist_suffix'=>' Example.Test ','v2board.stop_register'=>0,'v2board.recaptcha_enable'=>0,'v2board.email_gmail_limit_enable'=>0]);
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
 $guest=(new App\Services\Actions\Guest\CommActions)->config()->getOriginalContent()['data'];
 $assert($guest['email_whitelist_suffix']===['example.test']&&$guest['is_invite_force']===1,'Guest configuration differs from policy');
}finally{
 DB::rollBack();config(['v2board'=>$original]);RateLimiter::clear('127.0.0.1');foreach($emails as $email){Cache::forget(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$email));Cache::forget(App\Utils\CacheKey::get('LAST_SEND_EMAIL_VERIFY_TIMESTAMP',$email));}
}
echo "PASS: $checks registration policy checks\n";
