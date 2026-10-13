<?php
namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TelegramCommunityService
{
    public function enabled(): bool {
        return (bool) config('v2board.telegram_bot_enable', 0) && (bool) config('v2board.telegram_group_policy_enable', 0) && $this->chatId() < 0;
    }
    public function chatId(): int { return (int) config('v2board.telegram_discuss_id', 0); }
    public function graceDays(): int { return max(0, min(30, (int) config('v2board.telegram_group_grace_days', 3))); }
    public function eligibility(?User $user): string {
        if (!$user) return 'unbound';
        if ($user->banned) return 'banned';
        if (!$user->plan_id) return 'no_plan';
        if ($user->expired_at === null) return 'active';
        if ((int)$user->expired_at > time()) return 'active';
        return (int)$user->expired_at + $this->graceDays() * 86400 > time() ? 'grace' : 'expired';
    }
    public function eligible(?User $user): bool { return in_array($this->eligibility($user), ['active', 'grace'], true); }
    public function userForTelegram(int $id): ?User {
        $users = User::where('telegram_id', $id)->limit(2)->get();
        return $users->count() === 1 ? $users->first() : null;
    }
    public function observe(int $telegramId): void {
        if (!$this->enabled() || $telegramId <= 0) return;
        DB::table('v2_telegram_group_member')->insertOrIgnore([
            'chat_id'=>$this->chatId(), 'telegram_id'=>$telegramId, 'next_check_at'=>0,
        ]);
        DB::table('v2_telegram_group_member')->where('chat_id',$this->chatId())->where('telegram_id',$telegramId)->update(['next_check_at'=>0]);
    }
    public function bindingLink(User $user): array {
        abort_unless(config('v2board.telegram_bot_enable',0), 409, 'Telegram is disabled');
        abort_if($user->telegram_id, 409, 'Telegram is already linked');
        $bot = (new TelegramService())->getMe()->result;
        $token = bin2hex(random_bytes(24));
        $expires = time()+600;
        DB::table('v2_telegram_binding_challenge')->updateOrInsert(['user_id'=>$user->id], [
            'token_hash'=>hash('sha256',$token), 'telegram_id'=>null, 'telegram_name'=>null, 'expires_at'=>$expires,
        ]);
        return ['bindingUrl'=>'https://t.me/'.$bot->username.'?start=bind_'.$token, 'expiresAt'=>gmdate('c',$expires)];
    }
    public function acceptBinding(string $token, int $telegramId, string $name): void {
        abort_unless(preg_match('/^[a-f0-9]{48}$/D',$token) && $telegramId>0, 422, 'Invalid binding link');
        DB::transaction(function () use ($token,$telegramId,$name) {
            $query = DB::table('v2_telegram_binding_challenge')->where('token_hash',hash('sha256',$token));
            $row = $query->lockForUpdate()->first();
            abort_unless($row && $row->expires_at>time(), 409, 'Binding link expired');
            abort_if($row->telegram_id && (int)$row->telegram_id !== $telegramId, 409, 'Binding link already used');
            $query->update(['telegram_id'=>$telegramId,'telegram_name'=>mb_substr($name,0,128)]);
        });
    }
    public function confirmBinding(User $user, string $expectedTelegramId): void {
        abort_unless(config('v2board.telegram_bot_enable',0),409,'Telegram is disabled');
        Cache::lock('telegram:binding-write', 15)->block(5, function () use ($user, $expectedTelegramId) {
            DB::transaction(function () use ($user, $expectedTelegramId) {
                $row = DB::table('v2_telegram_binding_challenge')->where('user_id',$user->id)->lockForUpdate()->first();
                $account = User::where('id',$user->id)->lockForUpdate()->firstOrFail();
                abort_unless($row && $row->expires_at>time() && (string)$row->telegram_id === $expectedTelegramId, 409, 'Confirm the link in Telegram first');
                abort_if($account->telegram_id || User::where('telegram_id',$row->telegram_id)->exists(),409,'Telegram account already linked');
                DB::table('v2_telegram_preference')->where('user_id',$account->id)->delete();
                $account->telegram_id=$row->telegram_id;
                $account->save();
                DB::table('v2_telegram_binding_challenge')->where('user_id',$user->id)->delete();
                $this->observe((int)$row->telegram_id);
            });
        });
    }
    public function unbind(User $user): void {
        Cache::lock('telegram:binding-write',15)->block(5,function () use ($user) {
            DB::transaction(function () use ($user) {
                $account=User::where('id',$user->id)->lockForUpdate()->firstOrFail();
                if ($account->telegram_id) $this->observe((int)$account->telegram_id);
                DB::table('v2_telegram_preference')->where('user_id',$account->id)->delete();
                DB::table('v2_telegram_notification')->where('user_id',$account->id)->where('status','pending')->update(['status'=>'cancelled','finished_at'=>time()]);
                $account->telegram_id=null;
                $account->save();
                DB::table('v2_telegram_binding_challenge')->where('user_id',$user->id)->delete();
            });
        });
    }
    public function status(User $user): array {
        $pending=DB::table('v2_telegram_binding_challenge')->where('user_id',$user->id)->where('expires_at','>',time())->first();
        return [
            'linked'=>(bool)$user->telegram_id, 'telegramId'=>$user->telegram_id ? (string)$user->telegram_id : null,
            'pendingTelegramId'=>$pending && $pending->telegram_id ? (string)$pending->telegram_id : null,
            'pendingName'=>$pending->telegram_name ?? null,
            'groupManaged'=>$this->enabled(), 'eligibility'=>$this->eligibility($user), 'graceDays'=>$this->graceDays(),
            'graceEndsAt'=>$user->expired_at ? gmdate('c',(int)$user->expired_at+$this->graceDays()*86400) : null,
        ];
    }
    public function joinLink(User $user): array {
        abort_unless($this->enabled() && $user->telegram_id && $this->eligible($user),403,'Group membership requires a linked eligible account');
        $this->observe((int)$user->telegram_id);
        $this->reconcile((int)$user->telegram_id);
        $membership=DB::table('v2_telegram_group_member')->where('chat_id',$this->chatId())->where('telegram_id',$user->telegram_id)->first();
        abort_if($membership && ($membership->status==='kicked' || $membership->error_code),409,'Group membership requires administrator review');
        $expires=time()+600;
        $result=(new TelegramService())->call('createChatInviteLink',[
            'chat_id'=>$this->chatId(),'name'=>'Member request','expire_date'=>$expires,'creates_join_request'=>true,
        ]);
        return ['inviteUrl'=>$result->result->invite_link,'expiresAt'=>gmdate('c',$expires)];
    }
    public function handleUpdate(array $data): void {
        if (!$this->enabled()) return;
        $api=new TelegramService();
        $join=$data['chat_join_request'] ?? null;
        if ($join && (int)($join['chat']['id']??0)===$this->chatId()) {
            $id=(int)($join['from']['id']??0);
            if ($id<=0 || ($join['from']['is_bot']??false)) return;
            $this->observe($id);
            if ($this->eligible($this->userForTelegram($id))) $api->approveChatJoinRequest($this->chatId(),$id);
            else $api->declineChatJoinRequest($this->chatId(),$id);
        }
        $member=$data['chat_member'] ?? null;
        if ($member && (int)($member['chat']['id']??0)===$this->chatId() && !($member['new_chat_member']['user']['is_bot']??false)) {
            $id=(int)($member['new_chat_member']['user']['id']??0);
            $this->observe($id);
            if (($member['new_chat_member']['status']??'')==='kicked' && (int)($member['from']['id']??0)!==(int)$api->getMe()->result->id) {
                Cache::lock('telegram:member:'.$this->chatId().':'.$id,45)->block(2,function () use ($id) {
                    DB::table('v2_telegram_group_member')->where('chat_id',$this->chatId())->where('telegram_id',$id)->update(['policy_banned'=>false,'error_code'=>'MANUAL_BAN']);
                });
            }
        }
        $message=$data['message']??null;
        if ($message && (int)($message['chat']['id']??0)===$this->chatId()) {
            if (!($message['from']['is_bot']??false)) $this->observe((int)($message['from']['id']??0));
            foreach ($message['new_chat_members']??[] as $member) if (!($member['is_bot']??false)) $this->observe((int)$member['id']);
        }
    }
    public function reconcile(int $telegramId): void {
        if (!$this->enabled()) return;
        Cache::lock('telegram:member:'.$this->chatId().':'.$telegramId,45)->block(1,function () use ($telegramId) {
            $query=DB::table('v2_telegram_group_member')->where('chat_id',$this->chatId())->where('telegram_id',$telegramId);
            $row=$query->first();
            if (!$row) return;
            $api=new TelegramService();
            $member=$api->call('getChatMember',['chat_id'=>$this->chatId(),'user_id'=>$telegramId])->result;
            $status=$member->status;
            if (in_array($status,['creator','administrator'],true)) {
                $query->update(['status'=>'administrator','checked_at'=>time(),'next_check_at'=>time()+3600,'error_code'=>null]);
                return;
            }
            $eligible=$this->eligible($this->userForTelegram($telegramId));
            if ($status!=='kicked' && $row->policy_banned) {
                $query->update(['policy_banned'=>false]);
                $row->policy_banned=false;
            }
            if ($eligible && $row->policy_banned && $status==='kicked') {
                $api->call('unbanChatMember',['chat_id'=>$this->chatId(),'user_id'=>$telegramId,'only_if_banned'=>true]);
                $query->update(['policy_banned'=>false]);
                $status='left';
            } elseif (!$eligible && ($status==='member' || ($status==='restricted' && ($member->is_member??false)))) {
                // Persist an uncertain outcome separately; never automatically unban a manual/ambiguous ban.
                $query->update(['status'=>'ban_pending','error_code'=>'BAN_OUTCOME_PENDING']);
                $api->call('banChatMember',['chat_id'=>$this->chatId(),'user_id'=>$telegramId]);
                $query->update(['policy_banned'=>true]);
                $row->policy_banned=true;
                $status='kicked';
            }
            $ambiguous=($row->status==='ban_pending' || $row->error_code==='BAN_REQUIRES_REVIEW') && !$row->policy_banned && $status==='kicked';
            $query->update(['status'=>$status,'checked_at'=>time(),'next_check_at'=>time()+300,'error_code'=>$ambiguous?'BAN_REQUIRES_REVIEW':($status==='kicked' && !$row->policy_banned && $row->error_code==='MANUAL_BAN'?'MANUAL_BAN':null)]);
        });
    }
}
