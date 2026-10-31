<?php
namespace App\Services;

class TimeZones {
    public static function all(): array { return \DateTimeZone::listIdentifiers(\DateTimeZone::ALL); }
    public static function choices(): array {
        $now=new \DateTimeImmutable('now',new \DateTimeZone('UTC'));
        return array_map(function ($zone) use ($now) {
            $local=$now->setTimezone(new \DateTimeZone($zone));
            return ['id'=>$zone,'offset'=>'UTC'.$local->format('P'),'preview'=>$local->format('Y-m-d H:i:s')];
        },self::all());
    }
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
    /** Export instants with an explicit offset, independent of PHP's default zone. */
    public static function iso8601(?int $timestamp): ?string {
        if ($timestamp === null) return null;
        return (new \DateTimeImmutable('@'.$timestamp))->setTimezone(new \DateTimeZone(self::system()))->format('Y-m-d\TH:i:sP');
    }
    public static function forUser($user): string { return self::valid($user->display_timezone??null)?$user->display_timezone:self::system(); }
    public static function format(?int $timestamp,$user=null): ?string {
        if ($timestamp===null) return null;
        $zone=self::forUser($user);
        return (new \DateTimeImmutable('@'.$timestamp))->setTimezone(new \DateTimeZone($zone))->format('Y-m-d H:i:s').' '.$zone;
    }
}
