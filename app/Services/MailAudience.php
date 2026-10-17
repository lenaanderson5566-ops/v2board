<?php
namespace App\Services;
use App\Models\User;
use Illuminate\Support\Facades\DB;
class MailAudience
{
    public static function blocked(string $email, string $type): bool
    {
        if (MailBlocklist::contains($email)) return true;
        if (DB::table('v2_mail_suppression')->where('recipient_hash',MailDeliveryLog::recipientHash($email))->whereNull('released_at')->exists()) return true;
        if ($type!=='notify') return false;
        $user=User::where('email',$email)->first();
        return !$user || $user->banned || !$user->announcement_email;
    }
    public static function token(User $user): string
    {
        $id=(string)$user->id;
        return $id.'.'.hash_hmac('sha256','announcement-unsubscribe|'.$id.'|'.strtolower(trim($user->email)),(string)config('app.key'));
    }
    public static function recipient(string $token): ?User
    {
        if (!preg_match('/^([1-9][0-9]{0,19})\.[a-f0-9]{64}$/D',$token,$m)) return null;
        $user=User::find($m[1]);
        return $user && hash_equals(self::token($user),$token) ? $user : null;
    }
    public static function origin(): string
    {
        $origin=rtrim((string)config('v2board.email_public_url',config('app.url')),'/');
        if (!filter_var($origin,FILTER_VALIDATE_URL) || parse_url($origin,PHP_URL_SCHEME)!=='https' || parse_url($origin,PHP_URL_USER) || parse_url($origin,PHP_URL_QUERY) || parse_url($origin,PHP_URL_FRAGMENT)) throw new \RuntimeException('MAIL_UNSUBSCRIBE_HTTPS_REQUIRED');
        return $origin;
    }
    public static function withUnsubscribe(string $email, array $data): array
    {
        $user=User::where('email',$email)->firstOrFail();
        $origin=self::origin();
        $labels=['zh-CN'=>'退订推广邮件','zh-TW'=>'取消訂閱推廣郵件','en-US'=>'Unsubscribe from marketing emails','ja-JP'=>'販促メールの配信停止','ko-KR'=>'홍보 이메일 수신 거부','vi-VN'=>'Hủy nhận email tiếp thị','ru-RU'=>'Отписаться от рассылки','es-ES'=>'Cancelar correos promocionales','pt-BR'=>'Cancelar e-mails promocionais','fr-FR'=>'Se désabonner des e-mails promotionnels','de-DE'=>'Marketing-E-Mails abbestellen','id-ID'=>'Berhenti menerima email promosi','th-TH'=>'ยกเลิกการรับอีเมลส่งเสริมการขาย','fa-IR'=>'لغو اشتراک تبلیغات'];
        $data['unsubscribeUrl']=$origin.'/api/v10/mail/unsubscribe/'.self::token($user);
        $data['unsubscribeLabel']=$labels[$data['language']] ?? $labels['en-US'];
        return $data;
    }
}
