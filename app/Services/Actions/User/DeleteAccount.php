<?php
namespace App\Services\Actions\User;

use App\Models\{User, Order};
use App\Services\{AuthService, TelegramCommunityService};
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, RateLimiter};
use Illuminate\Http\Exceptions\HttpResponseException;

final class DeleteAccount
{
    private function fail(int $status, string $code): never
    {
        throw new HttpResponseException(response()->json(['message'=>$code, 'code'=>$code], $status));
    }
    public function blockers(User $user): array
    {
        $reasons = [];
        if ($user->is_admin) $reasons[] = 'ADMIN_ACCOUNT';
        if ((int)$user->balance !== 0 || (int)$user->commission_balance !== 0) $reasons[] = 'ACCOUNT_FUNDS';
        if (Order::where('user_id',$user->id)->whereIn('status',[0,1])->exists()) $reasons[] = 'OPEN_ORDERS';
        $beneficiaries=[$user->id]; $frontier=[$user->id];
        for ($level=0;$level<2;$level++) {
            $frontier=User::whereIn('invite_user_id',$frontier)->pluck('id')->all();
            $beneficiaries=array_merge($beneficiaries,$frontier);
            if (!$frontier) break;
        }
        if (Order::whereIn('invite_user_id',$beneficiaries)->where('commission_balance','>',0)->whereIn('commission_status',[0,1])->whereNotIn('status',[2])->exists()) $reasons[] = 'PENDING_COMMISSION';
        if (DB::table('v2_ticket')->where('user_id',$user->id)->where('status',0)->exists()) $reasons[]='OPEN_TICKETS';
        return $reasons;
    }
    public function remove(Request $request): void
    {
        $request->validate(['password'=>'required|string|max:128','confirmation'=>'required|in:DELETE']);
        if (!config('v2board.account_deletion_enable',0)) $this->fail(403,'ACCOUNT_DELETION_DISABLED');
        $id = (int)$request->user['id'];
        if (!RateLimiter::attempt('ACCOUNT_DELETION:'.$id,5,fn()=>true,300)) $this->fail(429,'RATE_LIMITED');
        DB::transaction(function () use ($request,$id) {
            $user = User::whereKey($id)->lockForUpdate()->firstOrFail();
            if ($user->banned) $this->fail(403,'ACCOUNT_DISABLED');
            $reference = AuthService::sessionReference($request->header('Authorization',''));
            if (!$reference || (int)$reference['userId'] !== $id || !AuthService::sessionUser($reference) || AuthService::authenticatedAt($reference)<time()-300) $this->fail(409,'RECENT_LOGIN_REQUIRED');
            if (!Helper::multiPasswordVerify($user->password_algo,$user->password_salt,$request->input('password'),$user->password)) $this->fail(422,'INCORRECT_PASSWORD');
            if ($reasons = $this->blockers($user)) $this->fail(409,$reasons[0]);
            // Keep a pseudonymous accounting reference, never credentials or account identity.
            app(TelegramCommunityService::class)->unbind($user);
            DB::table('v2_user_mfa')->insertOrIgnore(['user_id'=>$id]);
            DB::table('v2_user_mfa')->where('user_id',$id)->update(['email_enabled'=>0,'totp_secret'=>null,'recovery_hashes'=>null,'last_totp_step'=>-1,'version'=>DB::raw('version + 1')]);
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
            $user->forceFill([
                'account_deleted_at'=>time(), 'email'=>bin2hex(random_bytes(16)).'@deleted.invalid',
                'password'=>password_hash(bin2hex(random_bytes(32)),PASSWORD_DEFAULT), 'password_algo'=>null,'password_salt'=>null,
                'uuid'=>Helper::guid(true),'token'=>Helper::guid(),'banned'=>1,'telegram_id'=>null,
                'plan_id'=>null,'group_id'=>null,'expired_at'=>time(),'transfer_enable'=>0,'credit_balance'=>0,
                'auto_renewal'=>0,'announcement_email'=>0,'remind_service'=>0,'remind_expire'=>0,'remind_traffic'=>0,
                'last_login_ip'=>null,'last_login_at'=>null,'language'=>null,'display_timezone'=>null,'remarks'=>null,'invite_user_id'=>null,
            ])->save();
            // Revocation is fail-closed: MFA version also invalidates sessions if cache cleanup fails.
            (new AuthService($user))->removeAllSession();
        },3);
    }
}
