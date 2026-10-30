<?php
namespace App\Services;

use App\Models\User;
use App\Utils\Helper;

final class SubscriptionInfo
{
    public static function lines(User $user): array
    {
        if (!(int)config('v2board.show_info_to_server_enable', 0)) return [];
        $translations = require resource_path('client/copy.php');
        $copy = $translations[app()->getLocale()] ?? $translations['zh-CN'];
        $lines = [];
        $reset = (new UserService())->getResetInfo($user);
        $resetAt = $reset['at'];
        if ($resetAt) {
            // A subscription client cannot report its device zone; use the named business zone unless a preference is saved.
            $zone = TimeZones::valid($user->display_timezone) ? $user->display_timezone : $reset['timezone'];
            $date = \Carbon\Carbon::createFromTimestamp($resetAt, $zone);
            $key = $reset['state'] === 'pending' ? 'reset_pending' : ($reset['state'] === 'failed' ? 'reset_failed' : 'next_reset');
            $lines[] = $copy[$key].': '.$date->format('m-d H:i').' UTC'.$date->format('P').' · '.$zone;
            if ($zone !== $reset['timezone']) {
                $businessDate = \Carbon\Carbon::createFromTimestamp($resetAt, $reset['timezone']);
                $lines[] = $copy['reset_business_timezone'].': '.$reset['timezone'].' (UTC'.$businessDate->format('P').')';
            }
        }
        $credits = max(0, (int)$user->credit_balance);
        if ($credits > 0) $lines[] = $copy['independent'].': '.Helper::trafficConvert($credits);
        $resets = (int)(new UsageResetService())->available($user->id)->sum('remaining');
        if ($resets > 0) $lines[] = $copy['reset_count'].': '.sprintf($copy['reset_quantity'], $resets);
        return $lines;
    }
}
