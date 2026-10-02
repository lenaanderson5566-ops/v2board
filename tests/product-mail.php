<?php
// Local only: isolated Redis rate-limit keys; DB changes rolled back; transport always mocked.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\ProductMail;
use App\Services\MailRateLimiter;
use App\Jobs\SendEmailJob;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
$checks=0;
$assert=function($ok,$message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
DB::beginTransaction();
try {
    config(['v2board.app_name'=>'V2Board','v2board.app_url'=>'https://product.example', 'v2board.email_host'=>null]);
    $renderer = new ProductMail;
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        foreach (ProductMail::TYPES as $type) {
            $data=$renderer->data(['template_name'=>$type,'language'=>$language,'template_value'=>['code'=>'123456']]);
            $html=view('mail.product.message',$data)->render(); $plain=view('mail.product.text',$data)->render();
            $assert(strpos(strtolower($html),'v2board')===false && strpos($html,'lang="'.$language.'"')!==false,'Brand/language rendering failed');
            $assert(strlen($plain)>30 && strpos($plain,'<html')===false,'Missing plain text');
            $assert($data['direction']===($language==='fa-IR'?'rtl':'ltr'),'RTL incorrect');
        }
    }
    $user=App\Models\User::create(['email'=>'mail-test-'.bin2hex(random_bytes(5)).'@example.com','password'=>'not-a-login','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'language'=>'ja-JP']);
    $base=['email'=>$user->email,'template_name'=>'notify','subject'=>'Fallback','template_value'=>['content'=>'Fallback body']];
    $assert($renderer->data($base)['language']==='ja-JP','Stored language ignored');
    $assert($renderer->data($base+['language'=>'fa_IR'])['language']==='fa-IR','Explicit language ignored');
    $data=$renderer->data($base+['translations'=>['ja-JP'=>['subject'=>'日本語','content'=>'翻訳']]]);
    $assert($data['subject']==='日本語' && $data['contentText']==='翻訳','Localized announcement ignored');
    $assert($renderer->data($base)['subject']==='Fallback','Default announcement lost');
    $unsafe=$base; $unsafe['template_value']['content']='<script>alert(1)</script><img src="https://track.example"><a href="javascript:alert(1)" onclick="bad()">click</a><strong>safe</strong><a href="https://safe.example">link</a>';
    $html=$renderer->data($unsafe)['contentHtml'];
    $assert(strpos($html,'script')===false && strpos($html,'onclick')===false && strpos($html,'<img')===false && strpos($html,'<strong>safe</strong>')!==false && strpos($html,'https://safe.example')!==false,'Announcement sanitization failed');
    $config=new App\Http\Requests\Admin\UserSendMail;
    $assert(validator(['subject'=>'x','content'=>'y','translations'=>['ja-JP'=>['subject'=>'x']]],$config->rules())->fails(),'Incomplete translation accepted');
    $assert(validator(['subject'=>'x','content'=>'y','translations'=>['xx'=>['subject'=>'x','content'=>'y']]],$config->rules())->fails(),'Unknown locale accepted');
    $assert(!validator(['subject'=>'x','content'=>'y','translations'=>['ja-JP'=>['subject'=>'x','content'=>'y']]],$config->rules())->fails(),'Valid translation rejected');
    config(['mail.host'=>'isolated-'.bin2hex(random_bytes(8)), 'mail.username'=>'test','mail.from.address'=>'test@example.com']);
    $limiter=new MailRateLimiter;
    $scope='mail-rate:'.hash('sha256',config('mail.host').'|test|test@example.com');
    $redis=Cache::store('redis');
    $assert($limiter->domain('a@qq.com')===$limiter->domain('b@foxmail.com'),'QQ grouping failed');
    $assert($limiter->domain('a@163.com')===$limiter->domain('b@126.com'),'NetEase grouping failed');
    $assert($limiter->acquire('a@qq.com',true)===0,'First send blocked');
    $assert($limiter->acquire('b@gmail.com',false)>0,'Global budget not shared');
    $redis->forget($scope.':all');
    $assert($limiter->acquire('b@gmail.com',false)===0,'Bulk blocked transactional email');
    $redis->forget($scope.':all'); $redis->forget($scope.':bulk');
    $assert($limiter->acquire('b@foxmail.com',true)>0,'Provider budget not shared');
    $assert($limiter->acquire('a@qq.com', false, true)===0, 'Bulk budget delayed verification');
    $limiter->cooldown('a@163.com');
    $assert($limiter->acquire('b@126.com',false)>=59,'SMTP deferral cooldown missing');
    $assert($limiter->acquire('b@126.com',false,true)===0, 'Bulk rejection delayed verification');
    $limiter->cooldown('b@126.com',true);
    $assert($limiter->acquire('b@126.com',false,true)>0, 'Verification-specific rejection not backed off');
    $assert($limiter->permanent(new RuntimeException('Expected response code 250 but got code "550"')),'Permanent rejection not detected');
    $assert(!$limiter->permanent(new RuntimeException('Expected response code 250 but got code "421"')),'Temporary rejection treated as permanent');
    // Several independent processes contend for one sender: only one may acquire the first slot.
    $redis->forget($scope.':all'); $pids=[];
    Illuminate\Support\Facades\Redis::purge('cache');
    for ($i=0;$i<6;$i++) { $pid=pcntl_fork(); if ($pid===0) { $redis->put($scope.':result:'.$i, $limiter->acquire('parallel@example.com',false)===0?1:0, 60); posix_kill(getmypid(), SIGKILL); } $pids[]=$pid; }
    $allowed=0; foreach ($pids as $i=>$pid) { pcntl_waitpid($pid,$status); $allowed += (int)$redis->pull($scope.':result:'.$i); }
    $assert($allowed===1,'Concurrent workers exceeded shared budget');
    $fakeLimiter=new class extends MailRateLimiter { public $delay=0; public $cooldowns=0; public function acquire($email,$bulk,$priority=false) { return $this->delay; } public function cooldown($email, $priority=false) { $this->cooldowns++; } };
    $app->instance(MailRateLimiter::class,$fakeLimiter);
    $transport=new class { public $sent=0; public $error; public $rejected=[]; public function failures() { return $this->rejected; } public function forgetMailers() {} public function send(...$args) { $this->sent++; if($this->error) throw $this->error; } };
    Mail::swap($transport);
    $job=new SendEmailJob($base,'send_email_mass');
    $fakeLimiter->delay=10;
    $queued=new class extends Illuminate\Queue\Jobs\Job implements Illuminate\Contracts\Queue\Job {
        public $delay; public function getJobId() { return 'test'; } public function getRawBody() { return '{}'; }
        public function attempts() { return 1; } public function release($delay=0) { $this->delay=$delay; }
        public function fail($e=null) { $this->markAsFailed(); }
    }; $job->setJob($queued);
    $result=$job->handle(); $assert($result['deferred']===10 && $queued->delay===10 && $transport->sent===0,'Throttled job sent mail');
    $fakeLimiter->delay=0;
    $transport->error=new RuntimeException('Expected response code 250 but got code "421"');
    try { $job->handle(); $assert(false,'SMTP error swallowed'); } catch (RuntimeException $e) { $assert($fakeLimiter->cooldowns===1,'Missing transient cooldown'); }
    $transport->error=new RuntimeException('Expected response code 250 but got code "550"');
    $job->handle(); $assert($queued->hasFailed(), 'Permanent SMTP failure was retried');
    $transport->error=null;
    $transport->rejected=[$user->email];
    $result=(new SendEmailJob($base))->handle(); $assert(!empty($result['error']), 'Rejected recipient marked delivered');
    $transport->rejected=[];
    $result=(new SendEmailJob($base))->handle();
    $assert(empty($result['error']) && !isset($result['config']),'Success or SMTP secrecy incorrect');
    $otp=['email'=>$user->email,'language'=>'ko-KR','template_name'=>'verify','template_value'=>['code'=>'123456']];
    $otpJob=new SendEmailJob($otp);
    $assert($otpJob->connection==='redis' && $otpJob->queue==='send_email_priority' && $otpJob->backoff()[0]===5, 'Verification lacks priority queue / fast retry');
    $assert(config('horizon.environments.*.mail-priority.queue')===['send_email_priority'], 'Verification workers not isolated');
    $before=$transport->sent; $otpJob->handle();
    $assert($before===$transport->sent,'Expired verification code delivered');
    Cache::put(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$user->email),'123456',300);
    (new SendEmailJob($otp))->handle(); $assert($transport->sent===$before+1,'Valid verification code skipped');
    Cache::forget(App\Utils\CacheKey::get('EMAIL_VERIFY_CODE',$user->email));
    $before=$transport->sent;
    $preview=(new App\Http\Controllers\V1\Admin\ConfigController)->previewMail(Illuminate\Http\Request::create('/', 'POST',['template'=>'verify','language'=>'fa-IR']));
    $assert($preview->getStatusCode()===200 && $before===$transport->sent,'Preview sends email');
    $kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);
    $route=config('v2board.secure_path',config('v2board.frontend_admin_path','admin'));
    $request=Illuminate\Http\Request::create('/api/v1/'.$route.'/config/previewMail','POST',['template'=>'verify','language'=>'en-US']); $request->headers->set('Accept','application/json');
    $assert($kernel->handle($request)->getStatusCode()!==200,'Anonymous preview allowed');

    echo "Product mail: $checks checks passed; no real mail sent.\n";
} finally { DB::rollBack(); }
