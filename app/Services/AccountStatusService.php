<?php

namespace App\Services;

use App\Models\User;

class AccountStatusService
{
    /** UI classification only; authorization remains with the existing services. */
    public function forUser(User $user): array
    {
        $now = time();
        if ($user->banned) $state = 'banned';
        elseif ($user->credit_balance > 0) $state = 'active';
        elseif (!$user->plan_id) $state = 'new';
        elseif ($user->expired_at !== null && $user->expired_at <= $now) $state = 'expired';
        else $state = 'active';

        return [
            'state' => $state,
            'is_available' => (new UserService())->isAvailable($user),
            'quota_exhausted' => $state === 'active' && $user->credit_balance <= 0
                && $user->transfer_enable > 0
                && ($user->u + $user->d) >= $user->transfer_enable,
            'server_time' => $now,
        ];
    }
}
