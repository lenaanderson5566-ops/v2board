<?php
namespace App\Services;

final class NodeDisplayService
{
    public static function catalog(): array
    {
        static $catalog;
        return $catalog ?? ($catalog = json_decode(file_get_contents(resource_path('client/node-locations.json')), true, 512, JSON_THROW_ON_ERROR));
    }

    public static function regionCodes(): array
    {
        return array_keys(self::catalog()['regions']);
    }

    public static function identity(array $server): ?string
    {
        if (empty($server['id']) || empty($server['type'])) return null;
        return $server['type'].'_'.$server['id'];
    }

    public static function enrich(array $server): array
    {
        $id = self::identity($server);
        $server['node_id'] = $id;
        $server['proxy_name'] = $id ? 'node_'.$id : $server['name'];
        $server['display_names'] = [];
        foreach (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN', 'ru-RU', 'fa-IR'] as $language) {
            $server['display_names'][$language] = self::name($server, $language);
        }
        return $server;
    }

    public static function name(array $server, string $language): string
    {
        $catalog = self::catalog();
        $region = strtoupper((string)($server['region_code'] ?? ''));
        if (!isset($catalog['regions'][$region])) return $server['name'];
        $translate = fn ($names) => $names[$language] ?? $names['en-US'] ?? null;
        $parts = [$translate($catalog['regions'][$region])];
        $city = $server['city_code'] ?? '';
        if ($city !== '') $parts[] = $translate($catalog['cities'][$city] ?? []) ?? ucwords(str_replace('-', ' ', $city));
        $label = trim((string)($server['display_label'] ?? ''));
        // Preserve operator distinctions until a structured suffix has been filled in.
        $parts[] = $label !== '' ? $label : $server['name'];
        return implode(' · ', array_filter($parts, fn ($part) => $part !== null && $part !== ''));
    }

    public static function publicServers(array $servers, string $language): array
    {
        foreach ($servers as &$server) {
            $server['original_name'] = $server['name'];
            $region = strtoupper((string)($server['region_code'] ?? ''));
            if (!isset(self::catalog()['regions'][$region])) continue;
            $flag = mb_chr(0x1F1E6 + ord($region[0]) - 65).mb_chr(0x1F1E6 + ord($region[1]) - 65);
            $server['name'] = $flag.' '.$region.' · '.self::name($server, $language);
        }
        unset($server);
        return $servers;
    }

    public static function metadata(array $server): array
    {
        $server = self::enrich($server);
        return [
            'nodeId'=>$server['node_id'], 'proxyName'=>$server['proxy_name'],
            'name'=>$server['name'], 'regionCode'=>$server['region_code'] ?? null,
            'cityCode'=>$server['city_code'] ?? null, 'displayLabel'=>$server['display_label'] ?? null,
            'tags'=>array_values(array_filter($server['tags'] ?? [], 'is_string')),
            'displayNames'=>$server['display_names'],
        ];
    }
}
