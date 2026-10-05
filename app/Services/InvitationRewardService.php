<?php
namespace App\Services;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class InvitationRewardService
{
    public static function settings(): array {
        // A base group is required so an invited account can actually use standalone credits.
        $enabled = TrafficCreditService::baseGroupId() !== null;
        return [
            'validityMonths' => max(1, (int)config('v2board.invite_credit_months', 1)),
            'registrationBytes' => $enabled ? (int)round(max(0, (float)config('v2board.invite_registration_gb', 0)) * 1073741824) : 0,
            'firstUseBytes' => $enabled ? (int)round(max(0, (float)config('v2board.invite_first_use_gb', 0)) * 1073741824) : 0,
        ];
    }
    // Called inside the invitation acceptance transaction. Snapshot both promises at registration.
    public function register(User $user, int $invitationId): void {
        $settings = self::settings();
        if (!$settings['registrationBytes'] && !$settings['firstUseBytes']) return;
        DB::table('v2_invitation_reward')->insert([
            'user_id'=>$user->id, 'invitation_id'=>$invitationId,
            'validity_months'=>$settings['validityMonths'],
            'registration_bytes'=>$settings['registrationBytes'], 'first_use_bytes'=>$settings['firstUseBytes'], 'created_at'=>time(),
        ]);
        $this->grant($user, $settings['registrationBytes'], 'invite_register', $settings['validityMonths']);
    }
    // TrafficUpdate holds user locks first; retain that lock order for every reward operation.
    public function firstUse(int $userId): void {
        $user = User::where('id', $userId)->lockForUpdate()->first();
        if (!$user || $user->banned) return;
        $reward = DB::table('v2_invitation_reward')->where('user_id',$userId)->lockForUpdate()->first();
        if (!$reward || $reward->first_use_at !== null || $reward->first_use_bytes <= 0) return;
        $this->grant($user, (int)$reward->first_use_bytes, 'invite_first_use', (int)$reward->validity_months);
        DB::table('v2_invitation_reward')->where('id',$reward->id)->update(['first_use_at'=>time()]);
    }
    private function grant(User $user, int $bytes, string $kind, int $months): void {
        if ($bytes <= 0) return;
        DB::table('v2_traffic_credit_log')->insert([
            'user_id'=>$user->id,'reference'=>$kind.':'.$user->id,'kind'=>$kind,'bytes'=>$bytes,
            'snapshot'=>json_encode(['inviterId'=>$user->invite_user_id]),'created_at'=>time(),
        ]);
        CreditExpiryService::grant($user, $bytes, $kind.':'.$user->id, $months);
        if ($user->group_id === null) $user->group_id = TrafficCreditService::baseGroupId();
        $user->save();
    }
}
