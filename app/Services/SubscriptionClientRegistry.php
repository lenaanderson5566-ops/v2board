<?php
namespace App\Services;

final class SubscriptionClientRegistry
{
    // Storage keys remain stable so existing policies and historical statistics survive.
    public const CLIENTS = [
        'meta'=>['mihomo', \App\Protocols\ClashMeta::class, 'Mihomo / Clash Meta'],
        'sing'=>['sing-box', \App\Protocols\Singbox::class, 'sing-box'],
        'verge'=>['clash-verge', \App\Protocols\ClashVerge::class, 'Clash Verge'],
        'flclash'=>['flclash', \App\Protocols\FlClash::class, 'FlClash'],
        'nyanpasu'=>['clash-nyanpasu', \App\Protocols\ClashNyanpasu::class, 'Clash Nyanpasu'],
        'clashforandroid'=>['clash-for-android', \App\Protocols\ClashForAndroid::class, 'Clash for Android'],
        'clashforwindows'=>['clash-for-windows', \App\Protocols\ClashForWindows::class, 'Clash for Windows'],
        'clashx'=>['clashx', \App\Protocols\ClashX::class, 'ClashX'],
        'quantumult%20x'=>['quantumult-x', \App\Protocols\QuantumultX::class, 'Quantumult X'],
        'shadowrocket'=>['shadowrocket', \App\Protocols\Shadowrocket::class, 'Shadowrocket'],
        'surge'=>['surge', \App\Protocols\Surge::class, 'Surge'],
        'stash'=>['stash', \App\Protocols\Stash::class, 'Stash'],
        'loon'=>['loon', \App\Protocols\Loon::class, 'Loon'],
        'surfboard'=>['surfboard', \App\Protocols\Surfboard::class, 'Surfboard'],
        'sagernet'=>['sagernet', \App\Protocols\SagerNet::class, 'SagerNet'],
        'passwall'=>['passwall', \App\Protocols\Passwall::class, 'Passwall'],
        'ssrplus'=>['ssr-plus', \App\Protocols\SSRPlus::class, 'SSR Plus'],
        'shadowsocks'=>['shadowsocks', \App\Protocols\Shadowsocks::class, 'Shadowsocks'],
        'v2rayn'=>['v2rayn', \App\Protocols\V2rayN::class, 'v2rayN'],
        'v2rayng'=>['v2rayng', \App\Protocols\V2rayNG::class, 'v2rayNG'],
        'v2raytun'=>['v2raytun', \App\Protocols\V2RayTun::class, 'v2RayTun'],
    ];
    private const MIHOMO = ['meta','verge','flclash','nyanpasu','clashforandroid','clashforwindows','clashx'];

    public static function flag(string $id): ?string
    {
        $id = strtolower(trim($id));
        $id = ['clash'=>'meta', 'clash-meta'=>'meta', 'quantumult x'=>'quantumult%20x'][$id] ?? $id;
        if (isset(self::CLIENTS[$id])) return $id;
        foreach (self::CLIENTS as $flag => [$canonical]) if ($canonical === $id) return $flag;
        return null;
    }

    public static function compatible(string $client, string $format): bool
    {
        return $client === $format || (in_array($client, self::MIHOMO, true) && in_array($format, self::MIHOMO, true));
    }

    public static function policyTypes(string $client): array
    {
        return in_array($client, self::MIHOMO, true) ? array_values(array_unique([$client, 'meta'])) : [$client];
    }
}
