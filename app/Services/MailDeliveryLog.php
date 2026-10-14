<?php
namespace App\Services;

use App\Models\MailLog;

class MailDeliveryLog
{
    public static function recipientHash(string $email): string
    {
        return hash_hmac('sha256', strtolower(trim($email)), (string) config('app.key'));
    }
    public static function mask(string $email): string
    {
        $parts = explode('@', $email, 2);
        return count($parts) === 2 ? mb_substr($parts[0], 0, 1).'***@'.mb_substr($parts[1], 0, 55) : '***';
    }
    public static function begin(string $email, string $type, string $provider, string $stream = 'transactional'): MailLog
    {
        return MailLog::create([
            'user_id'=>\App\Models\User::where('email', $email)->value('id'),
            'email'=>self::mask($email), 'recipient_hash'=>self::recipientHash($email),
            // Subjects can contain verification codes; retain only the controlled template identifier.
            'subject'=>'', 'template_name'=>in_array($type, ProductMail::TYPES, true) ? $type : 'other',
            'stream'=>$stream, 'provider'=>$provider, 'status'=>'sending', 'error'=>null,
        ]);
    }
    public static function finish(MailLog $log, string $status, ?string $error, ?string $messageId, int $duration, ?int $transportCode = null, ?string $enhancedCode = null): void
    {
        try {
            $log->update(['status'=>$status, 'error_code'=>$error, 'message_id'=>$messageId, 'duration_ms'=>$duration, 'transport_code'=>$transportCode, 'enhanced_code'=>$enhancedCode]);
            if ($messageId) app(MailFeedback::class)->reconcile($log);
        } catch (\Throwable $e) {
            // Logging failure after sending must not cause the queue to resend the email.
            try { \Log::warning('Mail delivery receipt update failed', ['mail_log_id'=>$log->id]); }
            catch (\Throwable $ignored) { /* Never retry a delivery due to a failed log sink. */ }
        }
    }
}
