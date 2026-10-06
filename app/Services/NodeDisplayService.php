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

    /** Normalize display metadata before validation; omitted fields stay omitted. */
    public static function normalizeInput(array $input): array
    {
        $normalized = [];
        if (isset($input['region_code']) && is_string($input['region_code'])) {
            $normalized['region_code'] = strtoupper(trim($input['region_code']));
        }
        if (isset($input['city_code']) && is_string($input['city_code'])) {
            $city = trim($input['city_code']);
            foreach (self::catalog()['cities'] as $code => $names) {
                foreach ($names as $name) {
                    if (mb_strtolower($city) === mb_strtolower($name)) {
                        $city = $code;
                        break 2;
                    }
                }
            }
            $region = strtoupper(trim(is_string($input['region_code'] ?? null) ? $input['region_code'] : ''));
            $normalized['city_code'] = strtolower(preg_replace('/[\s_]+/u', '-', $city));
            $locationRegion = self::catalog()['cityRegions'][$normalized['city_code']] ?? null;
            if ($region !== '' && $locationRegion !== null && $region !== $locationRegion) {
                throw \Illuminate\Validation\ValidationException::withMessages(['city_code' => '所选州、省或城市不属于当前国家 / 地区，请重新选择']);
            }
        }
        return $normalized;
    }

    public static function validationMessages(): array
    {
        return [
            'region_code.string' => '国家 / 地区代码必须是文本',
            'region_code.size' => '请选择有效的国家 / 地区',
            'region_code.in' => '请选择有效的国家 / 地区',
            'city_code.string' => '位置标识必须是文本',
            'city_code.max' => '位置标识不能超过 64 个字符',
            'city_code.regex' => '位置请从参考列表选择，或输入英文州、省或城市名；已收录的中文名称可自动识别',
            'display_label.string' => '线路编号 / 后缀必须是文本',
            'display_label.max' => '线路编号 / 后缀不能超过 64 个字符',
        ];
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
        // Optional display fields must not bring the legacy operator name back into the UI.
        if ($label !== '') $parts[] = $label;
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
        // Public clients require unique names even when only the country is configured.
        return ClientConfigService::uniqueNames($servers, 'name');
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
