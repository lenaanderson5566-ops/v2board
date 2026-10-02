<?php
namespace App\Jobs;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Cache;
use App\Models\MailLog;
use App\Services\ProductMail;
use App\Services\MailRateLimiter;
use App\Utils\CacheKey;

class SendEmailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    protected $params;
    // Releases caused by rate limiting must not exhaust the delivery retry budget.
    public $tries = 0;
    public $maxExceptions = 5;
    public $timeout = 30;
    public $deadline;
    public function __construct($params, $queue = 'send_email')
    {
        $this->onConnection('redis');
        $this->onQueue(($params['template_name'] ?? '') === 'verify' ? 'send_email_priority' : $queue); $this->params = $params;
        $this->deadline = $params['expires_at'] ?? (time() + ($queue === 'send_email_mass' ? 7 * 86400 : 86400));
    }
    public function retryUntil() { return $this->deadline ?: time() + 86400; }
    public function backoff() { return ($this->params['template_name'] ?? '') === 'verify' ? [5, 15, 30, 60] : [60, 180, 600, 900]; }
    public function handle()
    {
        $params = $this->params;
        if ($this->deadline && time() >= $this->deadline) return ['skipped'=>true];
        if (($params['template_name'] ?? '') === 'verify') {
            $current = Cache::get(CacheKey::get('EMAIL_VERIFY_CODE', strtolower(trim($params['email']))));
            if (!$current || !hash_equals((string)$current, (string)($params['template_value']['code'] ?? ''))) return ['skipped'=>true];
        }
        // Queue delays must not deliver reminders after renewal, reset, or an opt-out.
        $type = $params['template_name'] ?? '';
        if (in_array($type, ['remindTraffic', 'remindExpire'], true)) {
            $user = \App\Models\User::where('email', $params['email'])->first();
            if (!$user || $user->banned) return ['skipped'=>true];
            if ($type === 'remindExpire' && (!$user->remind_expire || !$user->expired_at || $user->expired_at <= time() || $user->expired_at > time() + 86400)) return ['skipped'=>true];
            if ($type === 'remindTraffic' && (!$user->remind_traffic || !$user->transfer_enable || $user->u + $user->d < $user->transfer_enable * 0.95 || $user->u + $user->d >= $user->transfer_enable)) return ['skipped'=>true];
        }
        if (config('v2board.email_host')) {
            foreach (['host','port','encryption','username','password'] as $field) Config::set('mail.'.$field, config('v2board.email_'.$field));
            Config::set('mail.from.address', config('v2board.email_from_address'));
        }
        Config::set('mail.timeout', 15);
        $data = app(ProductMail::class)->data($params);
        Config::set('mail.from.name', $data['brand']);
        $limiter = app(MailRateLimiter::class);
        $priority = $type === 'verify';
        $delay = $limiter->acquire($params['email'], $this->queue === 'send_email_mass', $priority);
        if ($delay) {
            if ($this->job) $this->release($delay);
            return ['deferred'=>$delay, 'error'=>'Mail is rate limited. Please try again shortly.'];
        }
        $log = ['email'=>$params['email'], 'subject'=>$data['subject'], 'template_name'=>'mail.product.'. $params['template_name'], 'error'=>null];
        try {
            // MailManager caches the transport; rebuild it after applying persisted SMTP settings.
            Mail::forgetMailers();
            Mail::send(['html'=>'mail.product.message', 'text'=>'mail.product.text'], $data, function ($message) use ($params, $data) {
                $message->to($params['email'])->subject($data['subject']);
            });
            if (Mail::failures()) throw new \RuntimeException('SMTP did not accept the recipient.');
        } catch (\Exception $exception) {
            $permanent = $limiter->permanent($exception);
            $log['error'] = substr($exception->getMessage(), 0, 2000);
            MailLog::create($log);
            if (!$permanent) $limiter->cooldown($params['email'], $priority);
            if ($this->job) {
                if ($permanent) { $this->fail($exception); return $log; }
                throw $exception;
            }
            return $log + ['permanent'=>$permanent];
        }
        MailLog::create($log);
        return $log;
    }
}
