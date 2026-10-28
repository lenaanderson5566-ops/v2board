<?php
namespace App\Services\Actions\User;

use App\Models\User;
use App\Services\TelegramCommunityService;
use Illuminate\Support\Facades\DB;

/** Shared erasure only; callers authorize the request and lock the user in a transaction. */
final class EraseAccountData
{
    public function erase(User $user, bool $hardDelete = false): void
    {
        if (DB::transactionLevel() === 0) throw new \LogicException('Account erasure requires a transaction');
        $id = (int)$user->id;
        app(TelegramCommunityService::class)->unbind($user);
        if ($hardDelete) {
            DB::table('v2_user_mfa')->where('user_id',$id)->delete();
        } else {
            DB::table('v2_user_mfa')->insertOrIgnore(['user_id'=>$id]);
            DB::table('v2_user_mfa')->where('user_id',$id)->update(['email_enabled'=>0,'totp_secret'=>null,'recovery_hashes'=>null,'last_totp_step'=>-1,'version'=>DB::raw('version + 1')]);
        }
        foreach (['v2_passkey','v2_invite_code','v2_notice_read','v2_telegram_preference','v2_coupon_wallet','v2_mail_campaign_recipient'] as $table) DB::table($table)->where('user_id',$id)->delete();
        DB::table('v2_email_invitation')->where('user_id',$id)->orWhere('accepted_user_id',$id)->delete();
        $tickets=DB::table('v2_ticket')->where('user_id',$id)->pluck('id');
        DB::table('v2_ticket_message')->whereIn('ticket_id',$tickets)->delete();
        DB::table('v2_ticket_notification_read')->where('user_id',$id)->delete();
        DB::table('v2_ticket')->where('user_id',$id)->delete();
        DB::table('v2_client_diagnostic_report')->where('user_id',$id)->delete();
        // Preserve issuance history while permanently invalidating remaining entitlements.
        DB::table('v2_credit_batch')->where('user_id',$id)->update(['remaining_bytes'=>0]);
        DB::table('v2_usage_reset_credit')->where('user_id',$id)->update(['remaining'=>0]);
        User::where('invite_user_id',$id)->update(['invite_user_id'=>null]);
    }
}
