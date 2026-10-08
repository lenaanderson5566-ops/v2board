<?php
namespace App\Services;

use App\Jobs\SendEmailJob;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ServiceNotification
{
    /** Call only within the transaction that first grants the entitlement. */
    public static function schedule(User $user, bool $renewal): void
    {
        if (!$user->remind_service || $user->banned) return;
        $userId = $user->id;
        DB::afterCommit(function () use ($userId, $renewal) {
            try {
                $recipient = User::find($userId);
                if (!$recipient || !$recipient->remind_service || $recipient->banned) return;
                SendEmailJob::dispatch([
                    'email' => $recipient->email,
                    'template_name' => $renewal ? 'serviceRenewed' : 'serviceActivated',
                    'template_value' => [],
                ]);
            } catch (\Throwable $exception) {
                // Delivery infrastructure must not turn an already committed activation into a failure.
                Log::warning('Service notification enqueue failed.');
            }
        });
    }
}
