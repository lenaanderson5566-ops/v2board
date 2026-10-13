<?php
namespace App\Services;

class TimeZones {
    public static function all(): array { return \DateTimeZone::listIdentifiers(\DateTimeZone::ALL); }
    public static function valid($zone): bool { return is_string($zone) && in_array($zone,self::all(),true); }
    public static function system(): string {
        $zone=config('v2board.system_timezone','Asia/Shanghai');
        return self::valid($zone)?$zone:'Asia/Shanghai';
    }
    public static function apply(bool $reload=false): void {
        if ($reload && is_file($path=base_path('config/v2board.php'))) {
            if (function_exists('opcache_invalidate')) @opcache_invalidate($path,true);
            $settings=require $path;
            config(['v2board.system_timezone'=>$settings['system_timezone']??'Asia/Shanghai']);
        }
        config(['app.timezone'=>self::system()]);
        date_default_timezone_set(self::system());
    }
    public static function forUser($user): string { return self::valid($user->display_timezone??null)?$user->display_timezone:self::system(); }
    public static function format(?int $timestamp,$user=null): ?string {
        if ($timestamp===null) return null;
        $zone=self::forUser($user);
        return (new \DateTimeImmutable('@'.$timestamp))->setTimezone(new \DateTimeZone($zone))->format('Y-m-d H:i:s').' '.$zone;
    }
}
