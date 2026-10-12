<?php
namespace App\Services;

class ClientIdentity
{
    public const ALIASES = [
        'flclash' => ['FlClash'], 'verge' => ['ClashVergeRev', 'Clash-Verge', 'ClashVerge'],
        'nyanpasu' => ['ClashNyanpasu', 'Clash-Nyanpasu'],
        'clashforandroid' => ['ClashForAndroid'], 'clashforwindows' => ['ClashForWindows'],
        'clashx' => ['ClashX Pro', 'ClashX'], 'meta' => ['mihomo', 'Clash.Meta', 'ClashMeta'],
        'sing' => ['sing-box', 'singbox'], 'shadowrocket' => ['Shadowrocket'],
        'surge' => ['Surge'], 'stash' => ['Stash'], 'quantumult%20x' => ['Quantumult X', 'QuantumultX', 'Quantumult%20X'],
        'loon' => ['Loon'], 'surfboard' => ['Surfboard'], 'sagernet' => ['SagerNet'],
        'passwall' => ['Passwall'], 'ssrplus' => ['SSRPlus'], 'shadowsocks' => ['Shadowsocks'],
        'v2rayng' => ['v2rayNG'], 'v2rayn' => ['v2rayN'], 'v2raytun' => ['v2RayTun'],
    ];

    public static function normalizeVersion(string $value): ?string
    {
        return preg_match('/^v?(\d+(?:\.\d+){0,3}(?:-(?:alpha|beta|rc)[.-]?\d*)?)(?:\+[a-z0-9.-]+)?$/i', trim($value), $m)
            ? strtolower($m[1]) : null;
    }

    public static function allowsVersion(?string $minimum, ?string $current): bool
    {
        if (trim((string) $minimum) === '') return true;
        $minimum = self::normalizeVersion($minimum);
        $current = self::normalizeVersion((string) $current);
        if ($minimum === null || $current === null) return false;
        $pad = fn ($v) => preg_replace_callback('/^\d+(?:\.\d+)*/', fn ($m) => implode('.', array_pad(explode('.', $m[0]), 4, '0')), $v);
        return version_compare($pad($current), $pad($minimum), '>=');
    }

    public static function version(string $type, string $ua): ?string
    {
        foreach (self::ALIASES[$type] ?? [] as $alias) {
            if (preg_match('/(?:^|[^a-z0-9])'.preg_quote($alias, '/').'[\/\s_-]+(v?\d+(?:\.\d+){0,3}(?:-(?:alpha|beta|rc)[.-]?\d*)?(?:\+[a-z0-9.-]+)?)(?=$|[\s;()])/i', $ua, $m)) {
                return self::normalizeVersion($m[1]);
            }
        }
        return null;
    }

    public static function identify(string $ua): ?string
    {
        // First product token only: browsers carrying a client name are not clients.
        foreach (array_keys(self::ALIASES) as $type) {
            $aliases = self::matchingAliases($type);
            foreach ($aliases as $alias) {
                if (preg_match('/^'.preg_quote($alias, '/').'(?=$|[\/\s_-])/i', trim($ua))) return $type;
            }
        }
        return null;
    }

    public static function matchingAliases(string $type): array
    {
        $extra = ['meta'=>['ClashMetaForAndroid'], 'sing'=>['Hiddify', 'HiddifyNext', 'HiddifyNextX', 'SFA', 'SFI', 'SFM', 'SFT']];
        return array_merge(self::ALIASES[$type] ?? [], $extra[$type] ?? []);
    }

    public static function whitelistAllows(string $ua, bool $enabled, array $allowed): bool
    {
        return !$enabled || (($type = self::identify($ua)) !== null && in_array($type, $allowed, true));
    }
}
