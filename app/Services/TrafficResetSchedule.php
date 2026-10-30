<?php
namespace App\Services;

class TrafficResetSchedule
{
    public static function due(int $method, int $expiry, int $at, ?string $timezone = null): bool
    {
        if ($expiry <= $at) return false;
        $zone = new \DateTimeZone($timezone ?? date_default_timezone_get());
        $local = (new \DateTimeImmutable('@'.$at))->setTimezone($zone);
        $end = (new \DateTimeImmutable('@'.$expiry))->setTimezone($zone);
        switch ($method) {
            case 0: return $local->format('d') === '01';
            case 1:
                $day = min((int)$end->format('d'), (int)$local->format('t'));
                return (int)$local->format('d') === $day && $at < $expiry - 2160000;
            case 3: return $local->format('md') === '0101';
            case 4: return $local->format('m-d') === $end->format('m-d');
            default: return false;
        }
    }

    public static function next(int $method, ?int $expiry, ?int $now = null, ?string $timezone = null): ?int
    {
        $now = $now ?? time();
        if (!$expiry || $expiry <= $now || $method === 2) return null;
        // reset:traffic is scheduled daily at 00:00 in the application timezone.
        $zone = new \DateTimeZone($timezone ?? date_default_timezone_get());
        $candidate = (new \DateTimeImmutable('@'.$now))->setTimezone($zone)->modify('tomorrow')->setTime(0, 0);
        for ($i = 0; $i < 1462 && $candidate->getTimestamp() < $expiry; $i++) {
            if (self::due($method, $expiry, $candidate->getTimestamp(), $zone->getName())) return $candidate->getTimestamp();
            $candidate = $candidate->modify('+1 day')->setTime(0, 0);
        }
        return null;
    }
}
