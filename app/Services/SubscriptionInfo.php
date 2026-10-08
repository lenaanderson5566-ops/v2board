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
        $resetAt = (new UserService())->getResetAt($user);
        if ($resetAt) {
            $date = \Carbon\Carbon::createFromTimestamp($resetAt, config('app.timezone', 'UTC'));
            $offset = $date->utcOffset();
            $zone = 'GMT';
            if ($offset !== 0) {
                $zone .= ($offset > 0 ? '+' : '-').intdiv(abs($offset), 60);
                if (abs($offset) % 60) $zone .= ':'.sprintf('%02d', abs($offset) % 60);
            }
            $lines[] = $copy['next_reset'].': '.$date->format('m-d H:i').' '.$zone;
        }
        $credits = max(0, (int)$user->credit_balance);
        if ($credits > 0) $lines[] = $copy['independent'].': '.Helper::trafficConvert($credits);
        $resets = (int)(new UsageResetService())->available($user->id)->sum('remaining');
        if ($resets > 0) $lines[] = $copy['reset_count'].': '.sprintf($copy['reset_quantity'], $resets);
        return $lines;
    }
}
