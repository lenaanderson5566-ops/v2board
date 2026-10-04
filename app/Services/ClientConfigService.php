<?php

namespace App\Services;

class ClientConfigService
{
    public static function uniqueNames(array $items, string $field, array $reserved = []): array
    {
        $used = array_fill_keys($reserved, true);
        foreach ($items as &$item) {
            // Names also appear in line-based clients; keep control characters and commas out.
            $name = trim(str_replace(',', '，', preg_replace('/[\x00-\x1f\x7f]/u', ' ', (string) ($item[$field] ?? ''))));
            if ($name === '') $name = 'Node';
            $candidate = $name;
            $suffix = 2;
            while (isset($used[$candidate])) $candidate = $name . ' (' . $suffix++ . ')';
            $item[$field] = $candidate;
            $used[$candidate] = true;
        }
        unset($item);
        return $items;
    }

    public static function clash(array $config, array $nodes): array
    {
        if (!isset($config['proxy-groups']) || !is_array($config['proxy-groups'])) {
            throw new \RuntimeException('客户端模板缺少 proxy-groups');
        }
        $existing = $config['proxies'] ?? [];
        $reserved = array_merge(['DIRECT', 'REJECT', 'GLOBAL'], array_column($config['proxy-groups'], 'name'), array_column($existing, 'name'));
        $nodes = self::uniqueNames($nodes, 'name', $reserved);
        $names = array_column($nodes, 'name');
        $config['proxies'] = array_merge($existing, $nodes);
        foreach ($config['proxy-groups'] as &$group) {
            $members = [];
            $filtered = false;
            foreach ($group['proxies'] ?? [] as $source) {
                if (@preg_match($source, '') !== false) {
                    $filtered = true;
                    foreach ($names as $name) {
                        if (@preg_match($source, $name)) $members[] = $name;
                    }
                } else {
                    $members[] = $source;
                }
            }
            if (!$filtered) $members = array_merge($members, $names);
            $group['proxies'] = array_values(array_unique($members));
            // Do not remove referenced groups or silently fall back to direct traffic.
            if (!$group['proxies'] && empty($group['use'])) $group['proxies'] = ['REJECT'];
        }
        unset($group);
        // Replace BEFORE serializing: quotes/newlines in a brand must not corrupt YAML.
        $appName = trim(str_replace(',', '，', preg_replace('/[\x00-\x1f\x7f]/u', ' ', (string) config('v2board.app_name', 'V2Board'))));
        if ($appName === '' || in_array($appName, array_merge(['DIRECT', 'REJECT', 'GLOBAL'], $names, array_column($existing, 'name'), array_column($config['proxy-groups'], 'name')), true)) $appName = 'Proxy selection';
        array_walk_recursive($config, function (&$value) use ($appName) {
            if (is_string($value)) $value = str_replace('$app_name', $appName, $value);
        });
        return $config;
    }
}
