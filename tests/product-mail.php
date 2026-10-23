<?php
// Local only: isolated Redis rate-limit keys; DB changes rolled back; transport always mocked.
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function($e) {fwrite(STDERR,'FAIL: '.get_class($e).': '.$e->getMessage().PHP_EOL);exit(1);});
if ($testDatabase=getenv('PRODUCT_MAIL_DATABASE')) {
    if (!preg_match('/^notification_install_[a-f0-9]{8}$/D',$testDatabase)) throw new RuntimeException('Unsafe test database');
    $connection=config('database.connections.mysql');$connection['database']=$testDatabase;
    config(['database.connections.product_mail_test'=>$connection,'database.default'=>'product_mail_test','cache.prefix'=>'mail-test:'.$testDatabase.':']);
    Illuminate\Support\Facades\DB::purge('product_mail_test');
}

use App\Services\Mail\ProductMail;
use App\Services\Mail\MailRateLimiter;
use App\Jobs\SendEmailJob;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
$checks=0;
$assert = \Tests\Support\Assertions::counter($checks);
DB::beginTransaction();
try {
    config(['v2board.app_name'=>'V2Board','v2board.app_url'=>'https://product.example', 'v2board.email_provider'=>'smtp', 'v2board.email_host'=>null,'v2board.email_public_url'=>'https://api.example.test','v2board.email_announcement_separate'=>0,'v2board.email_announcements_enabled'=>1,'v2board.email_password_encrypted'=>false]);
    $renderer = new ProductMail;
    $catalog = require resource_path('mail/copy.php');
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        $assert(isset($catalog[$language]) && array_keys($catalog[$language])===array_keys($catalog['en-US']), 'Missing email language keys: '.$language);
    }
    $assert(ProductMail::language('es-MX')==='es-ES' && ProductMail::language('pt-PT')==='pt-BR', 'Regional language aliases lost');
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        $data = $renderer->data(['template_name'=>'ticketReply', 'language'=>$language,
            'template_value'=>['ticket_id'=>12345, 'ticket_subject'=>'PRIVATE_SUBJECT_SENTINEL', 'message'=>'PRIVATE_REPLY_SENTINEL']]);
        $html = view('mail.product.message', $data)->render();
        $plain = view('mail.product.text', $data)->render();
        $serialized = json_encode($data).$html.$plain;
        $assert(strpos($serialized, 'PRIVATE_SUBJECT_SENTINEL')===false && strpos($serialized, 'PRIVATE_REPLY_SENTINEL')===false, 'Ticket content leaked into notification');
        $assert(strpos($html, '#12345')!==false && strpos($plain, '#12345')!==false, 'Ticket reference missing');
        $assert(substr($data['url'], -12)==='/app#/ticket', 'Ticket notification link incorrect');
        $legacy = $renderer->data(['template_name'=>'ticketReply', 'language'=>$language, 'template_value'=>['ticket_subject'=>'PRIVATE_SUBJECT_SENTINEL', 'message'=>'PRIVATE_REPLY_SENTINEL']]);
        $assert($legacy['contentText']==='' && $legacy['contentHtml']==='', 'Legacy queued ticket body leaked');
    }
    foreach (App\Services\LanguagePreferenceService::SUPPORTED as $language) {
        foreach (ProductMail::TYPES as $type) {
            $data=$renderer->data(['template_name'=>$type,'language'=>$language,'template_value'=>['code'=>'123456']]);
            $html=view('mail.product.message',$data)->render(); $plain=view('mail.product.text',$data)->render();
            $assert(strpos(strtolower($html),'v2board')===false && strpos($html,'lang="'.$language.'"')!==false,'Brand/language rendering failed');
            $assert(strlen($plain)>30 && strpos($plain,'<html')===false,'Missing plain text');
            // A running worker may still use pre-summary data after a template deployment.
            $legacyData=$data; unset($legacyData['preheader']);
            $legacyHtml=view('mail.product.message',$legacyData)->render();
            $assert(strpos($legacyHtml, e($data['title']))!==false, 'Missing optional preheader blocks delivery');
            if ($type==='verify') $assert(strpos($legacyHtml,'123456')!==false, 'Verification code lost without preheader');
            $assert($data['direction']===($language==='fa-IR'?'rtl':'ltr'),'RTL incorrect');
        }
    }
    $user=App\Models\User::create(['email'=>'mail-test-'.bin2hex(random_bytes(5)).'@example.com','password'=>'not-a-login','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'language'=>'ja-JP','announcement_email'=>1]);
    $base=['email'=>$user->email,'template_name'=>'notify','subject'=>'Fallback','template_value'=>['content'=>'Fallback body']];
    $assert($renderer->data($base)['language']==='ja-JP','Stored language ignored');
    $assert($renderer->data($base+['language'=>'fa_IR'])['language']==='fa-IR','Explicit language ignored');
    $data=$renderer->data($base+['translations'=>['ja-JP'=>['subject'=>'日本語','content'=>'翻訳']]]);
    $assert($data['subject']==='日本語' && $data['contentText']==='翻訳','Localized announcement ignored');
    $assert($renderer->data($base)['subject']==='Fallback','Default announcement lost');
    $fallback=$base+['language'=>'de-DE','source_language'=>'zh-CN','translations'=>[
        'de-DE'=>['subject'=>'Incomplete'], 'en-US'=>['subject'=>'English notice','content'=>'English body']]];
    $data=$renderer->data($fallback);
    $assert($data['language']==='en-US' && $data['subject']==='English notice' && $data['contentText']==='English body','Mail must fall back as a complete document');
    unset($fallback['translations']['en-US']);
    $data=$renderer->data($fallback);
    $assert($data['language']==='zh-CN' && $data['subject']==='Fallback','Mail original fallback');
    $unsafe=$base; $unsafe['template_value']['content']='<script>alert(1)</script><img src="https://track.example"><a href="javascript:alert(1)" onclick="bad()">click</a><strong>safe</strong><a href="https://safe.example">link</a>';
    $html=$renderer->data($unsafe)['contentHtml'];
    $assert(strpos($html,'script')===false && strpos($html,'onclick')===false && strpos($html,'<img')===false && strpos($html,'<strong>safe</strong>')!==false && strpos($html,'https://safe.example')!==false,'Announcement sanitization failed');
    $config=new App\Http\Requests\Admin\UserSendMail;
    $assert(validator(['purpose'=>'service','request_key'=>(string)Illuminate\Support\Str::uuid(),'subject'=>'x','content'=>'y','translations'=>['ja-JP'=>['subject'=>'x']]],$config->rules())->fails(),'Incomplete translation accepted');
    $assert(validator(['purpose'=>'service','request_key'=>(string)Illuminate\Support\Str::uuid(),'subject'=>'x','content'=>'y','translations'=>['xx'=>['subject'=>'x','content'=>'y']]],$config->rules())->fails(),'Unknown locale accepted');
    $assert(!validator(['purpose'=>'service','request_key'=>(string)Illuminate\Support\Str::uuid(),'subject'=>'x','content'=>'y','translations'=>['ja-JP'=>['subject'=>'x','content'=>'y']]],$config->rules())->fails(),'Valid translation rejected');
    $assert(validator(['subject'=>'x','content'=>'y'],$config->rules())->fails(),'Unclassified campaign accepted');
    $assert(validator(['purpose'=>'other','request_key'=>(string)Illuminate\Support\Str::uuid(),'subject'=>'x','content'=>'y'],$config->rules())->fails(),'Unknown campaign purpose accepted');
    config(['mail.host'=>'isolated-'.bin2hex(random_bytes(8)), 'mail.username'=>'test','mail.from.address'=>'test@example.com']);
    $limiter=new MailRateLimiter;
    $scope='mail-rate:'.hash('sha256',config('v2board.email_provider', 'smtp').'|'.config('v2board.email_mailgun_domain').'|'.config('mail.host').'|test|test@example.com');
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
    $transport=new class { public $sent=0; public $error; public function forgetMailers() {} public function send($views, $data, $callback) { foreach ($views as $view) view($view, $data)->render(); $this->sent++; if($this->error) throw $this->error; } };
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
    $transport->error=new Symfony\Component\Mailer\Exception\TransportException('Expected response code 250 but got code "550"');
    $result=(new SendEmailJob($base))->handle(); $assert(!empty($result['error']), 'Rejected recipient marked delivered');
    $transport->error=null;
    // Redis/Horizon retains serialized Job names across service namespace changes.
    $pending=new SendEmailJob($base, 'send_email_mass');
    $payload=serialize($pending);
    $restored=unserialize($payload, ['allowed_classes'=>[SendEmailJob::class]]);
    $assert($restored instanceof SendEmailJob && $restored->queue==='send_email_mass' && $restored->connection==='redis', 'Queued mail identity changed');
    $assert(!str_contains($payload, 'App\\Services\\'), 'Queued payload must not serialize service instances');
    $before=$transport->sent;
    $result=$restored->handle();
    $assert($transport->sent===$before+1, 'Restored queued mail did not reach the mocked transport');
    $assert(empty($result['error']) && !isset($result['config']),'Success or SMTP secrecy incorrect');
    $unsafe=$base; $unsafe['template_name']='test'; $unsafe['email']="valid@example.com\r\nBcc:other@example.com";
    $before=$transport->sent;
    $invalid=(new SendEmailJob($unsafe))->handle();
    $assert(!empty($invalid['error']) && $invalid['permanent'] && $transport->sent===$before, 'Legacy queued unsafe address reached transport');
    config(['v2board.email_host'=>'smtp.example.test', 'v2board.email_port'=>465, 'v2board.email_encryption'=>'ssl',
        'v2board.email_username'=>'test-user', 'v2board.email_password'=>'test-password', 'v2board.email_from_address'=>'sender@example.test']);
    (new SendEmailJob($base))->handle();
    $assert(config('mail.host')==='smtp.example.test' && config('mail.scheme')==='smtps' && config('mail.timeout')===15, 'Persisted SMTP settings not applied');
    config(['v2board.email_host'=>null]);
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

    // Real Redis delayed queue + limiter, simulated transport; no minute scheduler is invoked.
    if ($testDatabase) {
        $token=bin2hex(random_bytes(8));$ids=[];
        for($i=0;$i<3;$i++) $ids[]=App\Models\User::create(['email'=>"queue-$token-$i@example.test",'password'=>'not-a-login','uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'announcement_email'=>1])->id;
        $campaign=App\Services\Mail\MailCampaign::create(App\Models\User::whereIn('id',$ids),['request_key'=>(string)Illuminate\Support\Str::uuid(),'purpose'=>'service','subject'=>'Queue test','content'=>'Queue test','translations'=>[]],1);
        $testRedis=new Illuminate\Redis\RedisManager($app,config('database.redis.client'),['options'=>['prefix'=>"mail-queue-test:$token:"],'default'=>config('database.redis.default')]);
        $realQueue=new Illuminate\Queue\RedisQueue($testRedis,'send_email_mass','default',90,null);
        $realQueue->setContainer($app);$realQueue->setConnectionName('redis');
        $savedBus=Illuminate\Support\Facades\Bus::getFacadeRoot();
        $queueBus=new class($realQueue) {
            public function __construct(private $queue) {}
            public function dispatch($job) { return $this->queue->later($job->delay??0,$job,'',$job->queue); }
        };
        $timedTransport=new class {
            public array $times=[];
            public function forgetMailers() {}
            public function send($views,$data,$callback) { $this->times[]=microtime(true); }
        };
        Mail::swap($timedTransport);
        app()->instance(MailRateLimiter::class,new MailRateLimiter);
        config(['v2board.email_provider'=>'smtp','v2board.email_host'=>null,'v2board.email_announcement_separate'=>0,'v2board.email_send_interval'=>2,'v2board.email_bulk_interval'=>3,'v2board.email_domain_interval'=>5,'v2board.email_from_address'=>"queue-$token@example.test",'mail.from.address'=>"queue-$token@example.test",'mail.username'=>$token]);
        Illuminate\Support\Facades\Bus::swap($queueBus);
        try {
            foreach(DB::table('v2_mail_campaign_recipient')->where('campaign_id',$campaign)->pluck('id') as $id) $queueBus->dispatch(new App\Jobs\SendCampaignMailJob($id));
            $deadline=microtime(true)+25;
            do {
                if($reserved=$realQueue->pop('send_email_mass')) {
                    $command=unserialize($reserved->payload()['data']['command'],['allowed_classes'=>[App\Jobs\SendCampaignMailJob::class]]);
                    $assert($command instanceof App\Jobs\SendCampaignMailJob,'Unexpected isolated queue payload');
                    $command->handle();$reserved->delete();
                } else usleep(100000);
            } while(count($timedTransport->times)<3 && microtime(true)<$deadline);
            $assert(count($timedTransport->times)===3,'Campaign still depends on minute scheduler');
            $times=$timedTransport->times;
            $assert($times[1]-$times[0]>=4 && $times[2]-$times[1]>=4,'Provider interval bypassed');
            $assert($times[2]-$times[0]<20,'Seconds-based delivery regressed to minute scheduling');
            $assert(DB::table('v2_mail_campaign_recipient')->where('campaign_id',$campaign)->where('status','accepted')->where('attempts',1)->count()===3,'Deferred recipients not completed exactly once');
            echo 'PASS real Redis campaign: 3 simulated deliveries in '.round($times[2]-$times[0],2)." seconds (2/3/5 second settings)\n";
        } finally {
            Illuminate\Support\Facades\Bus::swap($savedBus);
            $realQueue->clear('send_email_mass'); // This Redis manager has a unique test-only prefix.
            $rateScope='mail-rate:'.hash('sha256','smtp|'.config('v2board.email_mailgun_domain').'|'.config('mail.host').'|'.$token.'|'."queue-$token@example.test");
            foreach([':all',':bulk',':lock',':'.hash('sha256','example.test').':bulk'] as $suffix) Cache::store('redis')->forget($rateScope.$suffix);
        }
    }
    echo "Product mail: $checks checks passed; no real mail sent.\n";
} finally { DB::rollBack(); }
