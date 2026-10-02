<?php
namespace App\Services;

class TrafficResetSchedule
{
    public static function due(int $method, int $expiry, int $at): bool
    {
        if ($expiry <= $at) return false;
        switch ($method) {
            case 0: return date('d', $at) === '01';
            case 1:
                $day = min((int)date('d', $expiry), (int)date('t', $at));
                return (int)date('d', $at) === $day && $at < $expiry - 2160000;
            case 3: return date('md', $at) === '0101';
            case 4: return date('m-d', $at) === date('m-d', $expiry);
            default: return false;
        }
    }

    public static function next(int $method, ?int $expiry, ?int $now = null): ?int
    {
        $now = $now ?? time();
        if (!$expiry || $expiry <= $now || $method === 2) return null;
        // reset:traffic is scheduled daily at 00:00 in the application timezone.
        $candidate = strtotime('tomorrow', $now);
        for ($i = 0; $i < 1462 && $candidate < $expiry; $i++) {
            if (self::due($method, $expiry, $candidate)) return $candidate;
            $candidate = strtotime('+1 day', $candidate);
        }
        return null;
    }
}
