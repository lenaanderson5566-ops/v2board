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
use App\Services\Mail\MailDeliveryLog;
use App\Services\Mail\MailgunSender;
use App\Exceptions\MailSendException;
use App\Services\Mail\ProductMail;
use App\Services\Mail\MailRateLimiter;
use App\Utils\CacheKey;

class SendEmailJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    protected $params;
    protected $deliveryId;
    // Releases caused by rate limiting must not exhaust the delivery retry budget.
    public $tries = 0;
    public $maxExceptions = 5;
    public $timeout = 30;
    public $deadline;
    public function __construct($params, $queue = 'send_email')
    {
        $this->deliveryId = (string) \Illuminate\Support\Str::uuid();
        $this->onConnection('redis');
        $this->onQueue(in_array($params['template_name'] ?? '', ['verify','mailLogin'],true) ? 'send_email_priority' : $queue); $this->params = $params;
        $this->deadline = $params['expires_at'] ?? (time() + ($queue === 'send_email_mass' ? 7 * 86400 : 86400));
    }
    public function retryUntil() { return $this->deadline ?: time() + 86400; }
    public function backoff() { return ($this->params['template_name'] ?? '') === 'verify' ? [5, 15, 30, 60] : [60, 180, 600, 900]; }
    public function handle()
    {
        $announcement=(($this->params['template_name'] ?? '')==='notify' && ($this->params['mail_purpose'] ?? 'marketing')==='marketing') || (($this->params['template_name'] ?? '')==='test' && ($this->params['test_stream'] ?? '')==='announcement');
        return \App\Services\Mail\MailChannel::run($announcement, fn()=>$this->deliver($announcement));
    }
    private function deliver(bool $announcement)
    {
        $params = $this->params;
        if ($this->deadline && time() >= $this->deadline) return ['skipped'=>true];
        if (\App\Services\Mail\MailBlocklist::contains($params['email'])) return $this->skipBlocked($announcement);
        if (($params['template_name'] ?? '') === 'verify') {
            if (isset($params['mfa_challenge_key'])) {
                $challenge = Cache::get($params['mfa_challenge_key']);
                if (!$challenge || $challenge['expiresAt'] <= time() || !isset($challenge['emailHash'])
                    || !hash_equals($challenge['emailHash'], hash_hmac('sha256', (string)($params['template_value']['code'] ?? ''), config('app.key')))) return ['skipped'=>true];
            } else {
                $current = Cache::get(CacheKey::get('EMAIL_VERIFY_CODE', strtolower(trim($params['email']))));
                if (!$current || !hash_equals((string)$current, (string)($params['template_value']['code'] ?? ''))) return ['skipped'=>true];
            }
        }
        // Queue delays must not deliver reminders after renewal, reset, or an opt-out.
        $type = $params['template_name'] ?? '';
        if (in_array($type, ['remindTraffic', 'remindExpire', 'serviceActivated', 'serviceRenewed'], true)) {
            $user = \App\Models\User::where('email', $params['email'])->first();
            if (!$user || $user->banned) return ['skipped'=>true];
            if (in_array($type, ['serviceActivated', 'serviceRenewed'], true) && !$user->remind_service) return ['skipped'=>true];
            if ($type === 'remindExpire' && (!$user->remind_expire || !$user->expired_at || $user->expired_at <= time() || $user->expired_at > time() + 86400)) return ['skipped'=>true];
            if ($type === 'remindTraffic' && (!$user->remind_traffic || !$user->transfer_enable || $user->u + $user->d < $user->transfer_enable * 0.95 || $user->u + $user->d >= $user->transfer_enable)) return ['skipped'=>true];
        }
        if ($type==='notify' && $announcement && !config('v2board.email_announcements_enabled',1)) return ['skipped'=>true,'reason'=>'announcements_paused'];
        if (\App\Services\Mail\MailAudience::blocked($params['email'],$type==='notify' && !$announcement ? 'service' : $type)) return $this->skipBlocked($announcement, 'MAIL_RECIPIENT_SUPPRESSED');
        $provider = config('v2board.email_provider', 'smtp');
        if ($provider === 'smtp' && config('v2board.email_host')) {
            foreach (['host','port','encryption','username'] as $field) Config::set('mail.'.$field, config('v2board.email_'.$field));
            Config::set('mail.from.address', config('v2board.email_from_address'));
        }
        if (config('v2board.email_from_address')) Config::set('mail.from.address',config('v2board.email_from_address'));
        Config::set('mail.scheme', config('mail.encryption') === 'ssl' || (int) config('mail.port') === 465 ? 'smtps' : 'smtp');
        Config::set('mail.timeout', 15);
        $data = app(ProductMail::class)->data($params);
        if ($type==='notify' && $announcement) $data=\App\Services\Mail\MailAudience::withUnsubscribe($params['email'],$data);
        Config::set('mail.from.name', $data['brand']);
        $limiter = app(MailRateLimiter::class);
        $priority = in_array($type,['verify','mailLogin'],true);
        $delay = $limiter->acquire($params['email'], $this->queue === 'send_email_mass', $priority);
        if ($delay) {
            if ($this->job) $this->release($delay);
            return ['deferred'=>$delay, 'error'=>'Mail is rate limited. Please try again shortly.'];
        }
        $log = MailDeliveryLog::begin($params['email'], $type, in_array($provider, ['smtp','mailgun','ses','resend'], true) ? $provider : 'unknown', $announcement ? 'announcement' : 'transactional');
        if (!empty($params['campaign_recipient_id'])) \Illuminate\Support\Facades\DB::table('v2_mail_campaign_recipient')->where('id',$params['campaign_recipient_id'])->update(['mail_log_id'=>$log->id]);
        $this->linkInvitation($log);
        $started = microtime(true);
        $messageId = null; $transportCode = null; $enhancedCode = null;
        try {
            \App\Services\Mail\MailBlocklist::enforce($params['email']);
            if (validator(['email'=>$params['email']], ['email'=>'required|string|email:rfc'])->fails()) {
                throw new \InvalidArgumentException('MAIL_RECIPIENT_INVALID', 550);
            }
            if ($provider === 'mailgun') {
                $sender = app(MailgunSender::class);
                $messageId = $sender->send($params['email'], $data);
            } elseif ($provider === 'ses') {
                $sender = app(\App\Services\Mail\SesSender::class);
                $messageId = $sender->send($params['email'], $data);
            } elseif ($provider === 'resend') {
                $this->deliveryId ??= (string) ($this->job?->getJobId() ?: \Illuminate\Support\Str::uuid());
                $sender = app(\App\Services\Mail\ResendSender::class);
                $messageId = $sender->send($params['email'], $data, $this->deliveryId);
            } elseif ($provider !== 'smtp') {
                throw new MailSendException('MAIL_PROVIDER_INVALID');
            } else {
                Config::set('mail.driver','smtp');
                $password = config('v2board.email_password');
                if (config('v2board.email_password_encrypted')) {
                    try { $password = \Illuminate\Support\Facades\Crypt::decryptString((string)$password); }
                    catch (\Throwable $e) { throw new MailSendException('SMTP_KEY_INVALID'); }
                }
                if (config('v2board.email_host')) Config::set('mail.password', $password);
                // Rebuild cached transport after applying persisted SMTP settings.
                Mail::forgetMailers();
                \App\Services\Mail\MailBlocklist::enforce($params['email']);
                Mail::send(['html'=>'mail.product.message', 'text'=>'mail.product.text'], $data, function ($message) use ($params, $data) {
                    if (!empty($data['unsubscribeUrl'])) {
                        $headers=$message->getSymfonyMessage()->getHeaders();
                        $headers->addTextHeader('List-Unsubscribe','<'.$data['unsubscribeUrl'].'>');
                        $headers->addTextHeader('List-Unsubscribe-Post','List-Unsubscribe=One-Click');
                    }
                    $message->to($params['email'])->subject($data['subject']);
                });
            }
            $transportCode = isset($sender) ? $sender->responseCode : null;
        } catch (\Throwable $exception) {
            if ($exception instanceof MailSendException && $exception->safeCode==='MAIL_MANUALLY_BLOCKED') {
                MailDeliveryLog::finish($log,'skipped','MAIL_MANUALLY_BLOCKED',null,0);
                return ['skipped'=>true,'reason'=>'manual_blocklist','log_id'=>$log->id];
            }
            if ($exception instanceof MailSendException) $transportCode = $exception->transportCode;
            elseif ($provider === 'smtp' && !($exception instanceof \InvalidArgumentException)) [$transportCode, $enhancedCode] = \App\Services\Mail\MailDiagnosis::smtp($exception);
            $uncertain = $exception instanceof MailSendException && $exception->uncertain;
            $permanent = $exception instanceof MailSendException ? !$exception->retryable : $limiter->permanent($exception);
            $code = $exception instanceof MailSendException ? $exception->safeCode
                : ($exception instanceof \InvalidArgumentException ? 'MAIL_RECIPIENT_INVALID' : ($permanent ? 'SMTP_REJECTED' : 'SMTP_SEND_FAILED'));
            MailDeliveryLog::finish($log, $uncertain ? 'uncertain' : 'failed', $code, null, (int)((microtime(true)-$started)*1000), $transportCode, $enhancedCode);
            if (!$permanent) $limiter->cooldown($params['email'], $priority);
            // Never put provider response text, credentials or message content into failed-job diagnostics.
            $safeException = new \RuntimeException($code);
            if ($this->job) {
                if ($permanent) { $this->fail($safeException); return ['error'=>$code, 'log_id'=>$log->id]; }
                throw $safeException;
            }
            return ['error'=>$code, 'log_id'=>$log->id, 'permanent'=>$permanent, 'transport_code'=>$transportCode, 'enhanced_code'=>$enhancedCode, 'advice'=>\App\Services\Mail\MailDiagnosis::advice($uncertain ? 'uncertain' : 'failed', $code, $transportCode, $enhancedCode)[1]];
        }
        MailDeliveryLog::finish($log, 'accepted', null, $messageId, (int)((microtime(true)-$started)*1000), $transportCode, $enhancedCode);
        return ['error'=>null, 'log_id'=>$log->id, 'status'=>'accepted', 'transport_code'=>$transportCode];
    }
    private function linkInvitation(\App\Models\MailLog $log): void
    {
        if (($this->params['template_name'] ?? '') !== 'emailInvitation' || empty($this->params['invitation_id']) || empty($this->params['invitation_token_hash'])) return;
        \App\Models\EmailInvitation::where('id', $this->params['invitation_id'])
            ->where('token_hash', $this->params['invitation_token_hash'])
            ->update(['mail_log_id'=>$log->id]);
    }

    private function skipBlocked(bool $announcement, string $code = 'MAIL_MANUALLY_BLOCKED'): array
    {
        $provider=config('v2board.email_provider','smtp');
        $log=MailDeliveryLog::begin($this->params['email'],$this->params['template_name'] ?? '',in_array($provider,['smtp','mailgun','ses','resend'],true) ? $provider:'unknown',$announcement ? 'announcement':'transactional');
        $this->linkInvitation($log);
        MailDeliveryLog::finish($log,'skipped',$code,null,0);
        // Keep the job result compatible with the late transport-time block check.
        return ['skipped'=>true,'reason'=>$code === 'MAIL_MANUALLY_BLOCKED' ? 'manual_blocklist' : $code,'log_id'=>$log->id];
    }

}
