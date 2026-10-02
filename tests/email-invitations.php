<?php
// Local integration test. All mail and queued jobs are faked; all DB writes roll back.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Jobs\SendInvitationEmailJob;
use App\Models\EmailInvitation;
use App\Models\User;
use App\Services\AuthService;
use App\Services\EmailInvitationService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
$checks = 0;
$assert = function ($condition, $message) use (&$checks) { if (!$condition) throw new RuntimeException($message); $checks++; };
$reject = function ($action, $code) use ($assert) {
    try { $action(); throw new RuntimeException('Unexpected success'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $error) { $assert($error->getStatusCode()===$code, 'Incorrect rejection status'); }
};
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$call = function ($path, $body=null, $token=null) use ($kernel) {
    $request = Illuminate\Http\Request::create('/api/v1/'.$path, $body===null?'GET':'POST', $body??[]);
    $request->headers->set('Accept','application/json');
    if ($token) $request->headers->set('Authorization',$token);
    return $kernel->handle($request);
};
$config = config('v2board');
$queue = Queue::getFacadeRoot(); $mail = Mail::getFacadeRoot();
Queue::fake(); Mail::fake();
DB::beginTransaction();
$users = []; $tokens = [];
try {
    config(['v2board.app_url'=>'https://site.example','v2board.stop_register'=>0,'v2board.invite_force'=>0,'v2board.invite_gen_limit'=>5,'v2board.email_verify'=>0,'v2board.email_whitelist_enable'=>0,'v2board.email_gmail_limit_enable'=>0,'v2board.recaptcha_enable'=>0,'v2board.register_limit_by_ip_enable'=>0,'v2board.try_out_plan_id'=>0]);
    $makeUser = function ($email) use (&$users) {
        $user=User::create(['email'=>$email,'password'=>password_hash('Test-phrase-123!',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
        $users[]=$user; return $user;
    };
    $suffix=bin2hex(random_bytes(6));
    $sender=$makeUser('sender-'.$suffix.'@example.com');
    $other=$makeUser('other-'.$suffix.'@example.com');
    $token=(new AuthService($sender))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']; $tokens[]=$token;
    $otherToken=(new AuthService($other))->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']; $tokens[]=$otherToken;
    $service=new EmailInvitationService();
    $recipient='friend-'.$suffix.'@example.com';
    $assert($call('user/invite/email/send',['email'=>'invalid'],$token)->getStatusCode()===422,'Invalid address accepted');
    $assert($call('user/invite/email/send',['email'=>$recipient])->getStatusCode()!==200,'Anonymous invitation accepted');
    $response=$call('user/invite/email/send',['email'=>$recipient],$token);
    $assert($response->getStatusCode()===200,'Send API failed: '.$response->getContent());
    $data=json_decode($response->getContent(),true)['data'];
    $assert($data['status']==='queued' && !isset($data['token_hash']), 'Send response leaked token or claimed delivery');
    $job=Queue::pushed(SendInvitationEmailJob::class)->first();
    $record=EmailInvitation::findOrFail($job->invitationId);
    $assert($job->queue==='send_email' && hash('sha256',$job->token)===$record->token_hash,'Private token or queue incorrect');
    $assert($record->expires_at>=time()+7*86400-5,'Expiry incorrect');
    $assert(!array_key_exists('token_hash',$record->toArray()),'Model leaked hash');
    $history=json_decode($call('user/invite/email/fetch?days=90',null,$token)->getContent(),true)['data'];
    $assert(count($history)===1 && $history[0]['email']===$recipient && !isset($history[0]['token_hash']),'History incorrect');
    $assert(json_decode($call('user/invite/email/fetch',null,$otherToken)->getContent(),true)['data']===[],'Other user can see invitations');
    $assert($call('user/invite/email/fetch?days=999',null,$token)->getStatusCode()===422,'Unbounded history accepted');
    $assert(!isset(json_decode($call('user/invite/fetch',null,$token)->getContent(),true)['data']['codes']),'Public codes still exposed');
    $assert($call('user/invite/save',null,$token)->getStatusCode()===410,'Public generation still enabled');
    $reject(fn()=>$service->send($sender->id,$sender->email),422);
    $reject(fn()=>$service->send($sender->id,$other->email),422);
    $reject(fn()=>$service->send($sender->id,$recipient),429);
    config(['v2board.invite_gen_limit'=>1]);
    $reject(fn()=>$service->send($sender->id,'limit-'.$suffix.'@example.com'),422);
    config(['v2board.invite_gen_limit'=>0]);
    $reject(fn()=>$service->send($other->id,'disabled-'.$suffix.'@example.com'),422);
    config(['v2board.invite_gen_limit'=>5]);
    $called=false;
    $reject(function () use ($service,$job,&$called) { $service->register($job->token,'wrong@example.com',function () use (&$called) { $called=true; }); },422);
    $assert(!$called && !$record->fresh()->accepted_at,'Recipient mismatch consumed invitation');
    $job->handle();
    $assert($record->fresh()->sent_at && $service->history($sender->id,90)[0]['status']==='sent','Fake mail delivery not tracked');
    $html=view('mail.emailInvitation',['name'=>'<unsafe>','url'=>'https://site.example/app#/register?invitation='.$job->token.'&email='.rawurlencode($recipient),'expires_at'=>$record->expires_at])->render();
    $assert(strpos($html,'&lt;unsafe&gt;')!==false && strpos($html,$job->token)!==false,'Mail template link or escaping incorrect');
    config(['v2board.invite_force'=>1]);
    $assert($call('passport/auth/register',['email'=>'noinvite-'.$suffix.'@example.com','password'=>'Test-phrase-123!'])->getStatusCode()===422,'Forced email invitation bypassed');
    $response=$call('passport/auth/register',['email'=>$recipient,'password'=>'Test-phrase-123!','invitation'=>$job->token]);
    $assert($response->getStatusCode()===200,'Private registration failed: '.$response->getContent());
    $registered=User::where('email',$recipient)->firstOrFail(); $users[]=$registered;
    $tokens[]=json_decode($response->getContent(),true)['data']['auth_data'];
    $assert($registered->invite_user_id===$sender->id && $record->fresh()->accepted_user_id===$registered->id,'Affiliate or accepted recipient missing');
    $assert($service->history($sender->id,90)[0]['status']==='accepted','Accepted history incorrect');
    $reject(fn()=>$service->register($job->token,$recipient,fn()=>throw new RuntimeException('Replay callback ran')),422);
    config(['v2board.invite_force'=>0]);
    $assert($call('passport/auth/register',['email'=>'legacy-'.$suffix.'@example.com','password'=>'Test-phrase-123!','invite_code'=>'oldcode'])->getStatusCode()===410,'Legacy public registration accepted');
    $expired=$service->send($sender->id,'expired-'.$suffix.'@example.com');
    $expiredJob=Queue::pushed(SendInvitationEmailJob::class)->last();
    $expired->update(['expires_at'=>time()-1,'last_requested_at'=>time()-61]);
    $assert($service->history($sender->id,90)[0]['status']==='expired','Expired status incorrect');
    $reject(fn()=>$service->register($expiredJob->token,$expired->email,fn()=>throw new RuntimeException('Expired callback ran')),422);
    $renewed=$service->send($sender->id,$expired->email);
    $renewedJob=Queue::pushed(SendInvitationEmailJob::class)->last();
    $assert($renewed->id===$expired->id && $renewedJob->token!==$expiredJob->token,'Resend did not rotate token');
    $expiredJob->handle();
    $assert(!$renewed->fresh()->sent_at,'Stale queued job delivered');
    $expiredJob->failed(new RuntimeException('stale job failure'));
    $assert(!$renewed->fresh()->failed_at,'Stale job failure changed renewed invitation');
    $reject(fn()=>$service->register($expiredJob->token,$expired->email,fn()=>throw new RuntimeException('Old token callback ran')),422);
    try { $service->register($renewedJob->token,$renewed->email,fn()=>throw new RuntimeException('simulated save failure')); }
    catch (RuntimeException $error) { $assert($error->getMessage()==='simulated save failure','Unexpected rollback error'); }
    $assert(!$renewed->fresh()->accepted_at,'Failed registration consumed invitation');
    Mail::swap(new class { public function send(...$args) { throw new RuntimeException('simulated SMTP failure'); } });
    try { $renewedJob->handle(); throw new RuntimeException('Mail failure ignored'); }
    catch (RuntimeException $error) { $assert($error->getMessage()==='Invitation email delivery failed.','Delivery retry error incorrect'); }
    $assert($renewed->fresh()->failed_at && $service->history($sender->id,90)[0]['status']==='failed','Failed delivery not tracked');
    for ($i=0;$i<20;$i++) RateLimiter::hit('email-invitation:'.$sender->id,86400);
    $reject(fn()=>$service->send($sender->id,'daily-'.$suffix.'@example.com'),429);
    $sender->update(['banned'=>1]);
    $reject(fn()=>$service->send($sender->id,'banned-'.$suffix.'@example.com'),403);
    $reject(fn()=>$service->register($renewedJob->token,$renewed->email,fn()=>throw new RuntimeException('Banned callback ran')),422);
    echo "Email invitations: $checks checks passed (mail/queue faked; DB rolled back).\n";
} finally {
    DB::rollBack(); config(['v2board'=>$config]); Queue::swap($queue); Mail::swap($mail);
    foreach ($users as $user) { (new AuthService($user))->removeAllSession(); RateLimiter::clear('email-invitation:'.$user->id); }
    foreach ($tokens as $token) Illuminate\Support\Facades\Cache::forget($token);
}
