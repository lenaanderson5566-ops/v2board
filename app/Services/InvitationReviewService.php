<?php
namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class InvitationReviewService {
    public function record(User $user, Request $request): void {
        $fingerprint = fn ($value, $kind) => $value === '' ? null : hash_hmac('sha256', $kind.':'.$value, (string)config('app.key'));
        $packed = @inet_pton((string)$request->ip());
        $ip = $packed === false ? null : $fingerprint(bin2hex($packed),'ip');
        $ua = $fingerprint(substr(trim((string)$request->userAgent()),0,1024),'ua');
        DB::transaction(function () use ($user,$ip,$ua) {
            DB::table('v2_registration_signal')->insertOrIgnore(['user_id'=>$user->id,'ip_hash'=>$ip,'ua_hash'=>$ua,'created_at'=>time()]);
            if (!$user->invite_user_id) return;
            $inviter = DB::table('v2_registration_signal')->where('user_id',$user->invite_user_id)->first();
            $signals = [
                'sameRegistrationIp'=>$inviter && $ip && $inviter->ip_hash ? hash_equals($inviter->ip_hash,$ip) : null,
                'sameRegistrationUa'=>$inviter && $ua && $inviter->ua_hash ? hash_equals($inviter->ua_hash,$ua) : null,
            ];
            DB::table('v2_invitation_review')->insertOrIgnore([
                'user_id'=>$user->id,'inviter_id'=>$user->invite_user_id,'signals'=>json_encode($signals),
                'state'=>in_array(true,$signals,true) ? 'pending' : (in_array(null,$signals,true) ? 'insufficient' : 'no_signal'),
                'revision'=>0,'created_at'=>time(),'updated_at'=>time(),
            ]);
        });
    }
}
