<?php
namespace App\Services;

final class SubscriptionClientRegistry
{
    // Canonical client IDs are shared by policy storage, UA recognition and output selection.
    public const CLIENTS = [
        'clash-party'=>['clash-party', \App\Protocols\ClashMeta::class, 'Clash Party / Mihomo Party'],
        'throne'=>['throne', \App\Protocols\UriSubscription::class, 'Throne'],
        'nekobox'=>['nekobox', \App\Protocols\ClashMeta::class, 'NekoBox for Android'],
        'husi'=>['husi', \App\Protocols\UriSubscription::class, 'Husi'],
        'mihomo'=>['mihomo', \App\Protocols\ClashMeta::class, 'Mihomo / Clash Meta'],
        'sing-box'=>['sing-box', \App\Protocols\Singbox::class, 'sing-box'],
        'clash-verge'=>['clash-verge', \App\Protocols\ClashVerge::class, 'Clash Verge'],
        'flclash'=>['flclash', \App\Protocols\FlClash::class, 'FlClash'],
        'clash-nyanpasu'=>['clash-nyanpasu', \App\Protocols\ClashNyanpasu::class, 'Clash Nyanpasu'],
        'clash-for-android'=>['clash-for-android', \App\Protocols\ClashForAndroid::class, 'Clash for Android'],
        'clash-for-windows'=>['clash-for-windows', \App\Protocols\ClashForWindows::class, 'Clash for Windows'],
        'clashx'=>['clashx', \App\Protocols\ClashX::class, 'ClashX'],
        'quantumult-x'=>['quantumult-x', \App\Protocols\QuantumultX::class, 'Quantumult X'],
        'shadowrocket'=>['shadowrocket', \App\Protocols\Shadowrocket::class, 'Shadowrocket'],
        'surge'=>['surge', \App\Protocols\Surge::class, 'Surge'],
        'stash'=>['stash', \App\Protocols\Stash::class, 'Stash'],
        'loon'=>['loon', \App\Protocols\Loon::class, 'Loon'],
        'surfboard'=>['surfboard', \App\Protocols\Surfboard::class, 'Surfboard'],
        'sagernet'=>['sagernet', \App\Protocols\SagerNet::class, 'SagerNet'],
        'passwall'=>['passwall', \App\Protocols\Passwall::class, 'Passwall'],
        'ssr-plus'=>['ssr-plus', \App\Protocols\SSRPlus::class, 'SSR Plus'],
        'shadowsocks'=>['shadowsocks', \App\Protocols\Shadowsocks::class, 'Shadowsocks'],
        'v2rayn'=>['v2rayn', \App\Protocols\V2rayN::class, 'v2rayN'],
        'v2rayng'=>['v2rayng', \App\Protocols\V2rayNG::class, 'v2rayNG'],
        'v2raytun'=>['v2raytun', \App\Protocols\V2RayTun::class, 'v2RayTun'],
    ];
    private const MIHOMO = ['mihomo','clash-verge','flclash','clash-nyanpasu','clash-for-android','clash-for-windows','clashx','clash-party','nekobox'];
    private const URI = ['v2rayn', 'v2rayng', 'throne', 'husi'];
    public static function defaultEnabled(string $client): bool
    {
        return !in_array($client, ['clash-party', 'throne', 'nekobox', 'husi'], true);
    }

    public static function canonicalId(string $id): ?string
    {
        $id = strtolower(trim($id));
        return isset(self::CLIENTS[$id]) ? $id : null;
    }

    public static function handler(string $id): ?string
    {
        $id = self::canonicalId($id);
        return $id === null ? null : self::CLIENTS[$id][1];
    }
    public static function compatible(string $client, string $format): bool
    {
        $client = self::canonicalId($client);
        $format = self::canonicalId($format);
        if ($client === null || $format === null) return false;
        return $client === $format
            || (in_array($client, self::MIHOMO, true) && in_array($format, self::MIHOMO, true))
            || (in_array($client, self::URI, true) && in_array($format, self::URI, true));
    }

    public static function policyTypes(string $client): array
    {
        return in_array($client, self::MIHOMO, true) ? array_values(array_unique([$client, 'mihomo'])) : [$client];
    }
}
