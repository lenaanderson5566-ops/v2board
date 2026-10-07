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
        $credits = max(0, (int)$user->credit_balance);
        if ($credits > 0) $lines[] = $copy['independent'].': '.Helper::trafficConvert($credits);
        $resets = (int)(new UsageResetService())->available($user->id)->sum('remaining');
        if ($resets > 0) $lines[] = $copy['reset_count'].': '.sprintf($copy['reset_quantity'], $resets);
        return $lines;
    }
}
