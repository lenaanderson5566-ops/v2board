<?php
namespace App\Services;

class TrafficResetSchedule
{
    public static function due(int $method, int $expiry, int $at, ?string $timezone = null, ?int $anchorAt = null): bool
    {
        if ($expiry <= $at) return false;
        $zone = new \DateTimeZone($timezone ?? date_default_timezone_get());
        $local = (new \DateTimeImmutable('@'.$at))->setTimezone($zone);
        if ($anchorAt !== null) {
            if (!in_array($method, [0, 1, 3, 4], true)) return false;
            $anchor = (new \DateTimeImmutable('@'.$anchorAt))->setTimezone($zone);
            if ($local->format('Y-m-d') <= $anchor->format('Y-m-d')) return false;
            if (($method === 3 || $method === 4) && $local->format('m') !== $anchor->format('m')) return false;
            // Clamp only this occurrence; a short month never changes the anchor.
            $day = min((int)$anchor->format('d'), (int)$local->format('t'));
            return (int)$local->format('d') === $day;
        }
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

    public static function next(int $method, ?int $expiry, ?int $now = null, ?string $timezone = null, ?int $anchorAt = null): ?int
    {
        $now = $now ?? time();
        if (!$expiry || $expiry <= $now || $method === 2) return null;
        // reset:traffic is scheduled daily at 00:00 in the application timezone.
        $zone = new \DateTimeZone($timezone ?? date_default_timezone_get());
        $candidate = (new \DateTimeImmutable('@'.$now))->setTimezone($zone)->modify('tomorrow')->setTime(0, 0);
        for ($i = 0; $i < 1462 && $candidate->getTimestamp() < $expiry; $i++) {
            if (self::due($method, $expiry, $candidate->getTimestamp(), $zone->getName(), $anchorAt)) return $candidate->getTimestamp();
            $candidate = $candidate->modify('+1 day')->setTime(0, 0);
        }
        return null;
    }
}
