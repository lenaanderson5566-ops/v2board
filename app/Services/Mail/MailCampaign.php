<?php
namespace App\Services\Mail;
use Illuminate\Support\Facades\DB;
use App\Models\User;
class MailCampaign
{
    public static function reason(User $user,string $purpose): ?string {
        if (MailBlocklist::contains($user->email)) return 'manual_blocklist';
        if ($user->banned) return 'account_disabled';
        if (DB::table('v2_mail_suppression')->where('recipient_hash',MailDeliveryLog::recipientHash($user->email))->whereNull('released_at')->exists()) return 'suppressed';
        if ($purpose==='marketing' && !$user->announcement_email) return 'not_subscribed';
        return null;
    }
    private static function audience($builder, string $purpose, int $administratorId, callable $consume): string
    {
        $fingerprint = hash_init('sha256', HASH_HMAC, (string)config('app.key'));
        hash_update($fingerprint, "mail-audience-v1:$administratorId:$purpose\n");
        (clone $builder)->select(['id', 'email', 'banned', 'announcement_email'])
            ->chunkById(500, function ($users) use ($purpose, $consume, $fingerprint) {
                $hashes = $users->mapWithKeys(fn ($user) => [$user->id => MailDeliveryLog::recipientHash($user->email)]);
                $manual = DB::table('v2_mail_blocklist')->whereIn('recipient_hash', $hashes)->whereNull('released_at')->pluck('recipient_hash')->flip();
                $blocked = DB::table('v2_mail_suppression')->whereIn('recipient_hash', $hashes)->whereNull('released_at')->pluck('recipient_hash')->flip();
                $rows = [];
                foreach ($users as $user) {
                    $hash = $hashes[$user->id];
                    $reason = match (true) {
                        isset($manual[$hash]) => 'manual_blocklist',
                        (bool)$user->banned => 'account_disabled',
                        isset($blocked[$hash]) => 'suppressed',
                        $purpose === 'marketing' && !$user->announcement_email => 'not_subscribed',
                        default => null,
                    };
                    $rows[] = ['user_id' => $user->id, 'recipient_hash' => $hash, 'reason' => $reason];
                    hash_update($fingerprint, "{$user->id}:$hash:$reason\n");
                }
                $consume($rows);
            });
        return hash_final($fingerprint);
    }
    public static function preview($builder, string $purpose, int $administratorId): array
    {
        return DB::transaction(function () use ($builder, $purpose, $administratorId) {
            $counts = ['total'=>0,'eligible'=>0,'account_disabled'=>0,'suppressed'=>0,'not_subscribed'=>0,'manual_blocklist'=>0];
            $token = self::audience($builder, $purpose, $administratorId, function ($rows) use (&$counts) {
                foreach ($rows as $row) {
                    $counts['total']++;
                    $counts[$row['reason'] ?: 'eligible']++;
                }
            });
            return $counts + ['audience_token' => $token];
        });
    }
    public static function create($builder,array $data,int $administratorId): int {
        $mail=app(ProductMail::class); $data['content']=$mail->safeHtml($data['content']);
        foreach($data['translations'] ?? [] as $language=>$variant) $data['translations'][$language]['content']=$mail->safeHtml($variant['content']);
        return DB::transaction(function() use($builder,$data,$administratorId) {
            $values=['request_key'=>$data['request_key'],'administrator_id'=>$administratorId,'purpose'=>$data['purpose'],'subject'=>$data['subject'],'content'=>$data['content'],'translations'=>json_encode($data['translations'] ?? [],JSON_UNESCAPED_UNICODE),'source_language'=>$data['source_language'] ?? null];
            $inserted=DB::table('v2_mail_campaign')->insertOrIgnore($values+['created_at'=>time(),'expires_at'=>time()+7*86400]);
            $campaign=DB::table('v2_mail_campaign')->where('request_key',$data['request_key'])->lockForUpdate()->first();
            abort_unless($campaign,500);
            foreach($values as $key=>$value) abort_unless((string)$campaign->$key===(string)$value,409,'该发送请求已使用，请重新打开群发窗口。');
            $id=(int)$campaign->id;
            if(!$inserted) return $id;
            $total = 0;
            $token = self::audience($builder, $data['purpose'], $administratorId, function ($rows) use ($id, &$total) {
                $records=[]; foreach($rows as $row) $records[]=$row+['campaign_id'=>$id,'status'=>$row['reason'] ? 'skipped':'queued','available_at'=>time(),'updated_at'=>time()];
                DB::table('v2_mail_campaign_recipient')->insert($records);
                $total += count($rows);
            });
            // Verify the exact rows written above. An outdated preview rolls back the entire campaign.
            abort_unless(hash_equals($token, $data['audience_token'])
                && (!isset($data['expected_count']) || $total === (int)$data['expected_count']),
                409, '收件范围或发送资格已变化，请重新检查收件范围后确认。');
            return $id;
        });
    }
    public static function stats(int $id): array {
        $q=DB::table('v2_mail_campaign_recipient as r')->where('r.campaign_id',$id);
        $rows=$q->selectRaw('r.status, r.delivery_status, COUNT(*) as n')->groupBy('r.status','r.delivery_status')->get();
        $out=['total'=>0,'queued'=>0,'sending'=>0,'accepted'=>0,'failed'=>0,'uncertain'=>0,'skipped'=>0,'delivered'=>0,'bounced'=>0,'complained'=>0,'rejected'=>0,'temporary'=>0,'unsubscribed'=>0];
        foreach($rows as $row) { $out['total']+=(int)$row->n; $out[$row->status]=($out[$row->status] ?? 0)+(int)$row->n; if($row->delivery_status) $out[$row->delivery_status]=($out[$row->delivery_status] ?? 0)+(int)$row->n; }
        $out['delivery_rate']=$out['accepted'] ? round($out['delivered']/$out['accepted']*100,2) : null;
        $out['feedback_count']=$out['delivered']+$out['bounced']+$out['complained']+$out['rejected']+$out['temporary']+$out['unsubscribed'];
        $out['skipped_reasons']=DB::table('v2_mail_campaign_recipient')->where('campaign_id',$id)->where('status','skipped')->selectRaw('reason, COUNT(*) as n')->groupBy('reason')->get();
        return $out;
    }
}
