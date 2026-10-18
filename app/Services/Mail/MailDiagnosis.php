<?php
namespace App\Services\Mail;

class MailDiagnosis
{
    /** Extract only codes, never persist SMTP response text or addresses. */
    public static function smtp(\Throwable $e): array
    {
        $text = $e->getMessage(); $code = null; $enhanced = null;
        if (preg_match('/got code ["\x27]?([45]\d{2})/i', $text, $m)) $code = (int)$m[1];
        elseif (preg_match('/^([45]\d{2})[ -]/', $text, $m)) $code = (int)$m[1];
        elseif ($e->getCode() >= 400 && $e->getCode() <= 599) $code = (int)$e->getCode();
        if ($code && preg_match('/\b('.intdiv($code,100).'\.[0-9]{1,3}\.[0-9]{1,3})\b/', $text, $m)) $enhanced = $m[1];
        return [$code, $enhanced];
    }
    public static function advice(string $status, ?string $error, ?int $code, ?string $enhanced): array
    {
        if ($error==='MAIL_MANUALLY_BLOCKED') return ['manual_blocklist','人工禁发名单拦截，未调用邮件服务商；请在邮件禁发名单核查备注。'];
        if ($status === 'accepted') return ['accepted','服务商已接受；最终投递、退信及投诉需核查服务商事件记录。'];
        if ($status === 'uncertain') return ['uncertain','结果不确定。先按消息 ID 和时间核查服务商记录，勿直接重发或清理用户。'];
        if (in_array($enhanced, ['5.1.1','5.1.2','5.1.3','5.2.1'], true)) return ['address_review','地址不存在、无效或邮箱已停用。核实用户当前邮箱，建议暂停向该地址发送非必要邮件；不要直接删除网站账号。'];
        if ($enhanced === '4.2.2' || $enhanced === '5.2.2') return ['mailbox_full','收件箱空间不足。联系用户清理邮箱后重试，不代表拉黑。'];
        if ($code === 535 || str_contains($error ?? '', 'AUTH') || str_contains($error ?? '', 'KEY_')) return ['configuration','检查发送凭据及权限。这是发送端配置问题，不应清理收件用户。'];
        if ($enhanced && str_starts_with($enhanced,'5.7.')) return ['policy','收件服务器策略拒绝。检查 SPF/DKIM/DMARC、发信信誉和内容，不能据此认定用户拉黑。'];
        if ($code === 429 || str_contains($error ?? '', 'RATE_LIMITED') || ($code >= 400 && $code < 500 && str_starts_with($error ?? '', 'SMTP'))) return ['temporary','限流或临时故障。降低发送频率，等待队列有限重试，不应清理用户。'];
        if ($status === 'failed') return ['review','按状态码检查通道配置和服务商记录。单次失败不等于用户拉黑或投诉。'];
        return ['unknown','暂无可靠投递结论。'];
    }
}
