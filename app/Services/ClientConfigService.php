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

    public static function clash(array $config, array $nodes, array $servers = []): array
    {
        if (!isset($config['proxy-groups']) || !is_array($config['proxy-groups'])) {
            throw new \RuntimeException('客户端模板缺少 proxy-groups');
        }
        $existing = $config['proxies'] ?? [];
        $reserved = array_merge(['DIRECT', 'REJECT', 'GLOBAL'], array_column($config['proxy-groups'], 'name'), array_column($existing, 'name'));
        $sources = array_column($servers, 'original_name', 'name');
        $before = array_column($nodes, 'name');
        $nodes = self::uniqueNames($nodes, 'name', $reserved);
        $names = array_column($nodes, 'name');
        $original = [];
        foreach ($names as $index=>$name) $original[$name] = $sources[$before[$index]] ?? $before[$index];
        $renamed = array_diff_key(array_flip(array_filter($original)), array_fill_keys(array_merge(['DIRECT', 'REJECT', 'GLOBAL'], array_column($config['proxy-groups'], 'name')), true));
        $config['proxies'] = array_merge($existing, $nodes);
        foreach ($config['proxy-groups'] as &$group) {
            $members = [];
            $filtered = false;
            foreach ($group['proxies'] ?? [] as $source) {
                if (@preg_match($source, '') !== false) {
                    $filtered = true;
                    foreach ($names as $name) {
                        if (@preg_match($source, $name) || @preg_match($source, $original[$name] ?? $name)) $members[] = $name;
                    }
                } else {
                    $members[] = $renamed[$source] ?? $source;
                }
            }
            if (!$filtered) $members = array_merge($members, $names);
            $group['proxies'] = array_values(array_unique($members));
            // Do not remove referenced groups or silently fall back to direct traffic.
            if (!$group['proxies'] && empty($group['use'])) $group['proxies'] = ['REJECT'];
        }
        unset($group);
        foreach ($config['rules'] ?? [] as $index=>$rule) {
            if (!is_string($rule)) continue;
            $parts = explode(',', $rule);
            $target = count($parts)-1;
            if (($parts[$target] ?? '') === 'no-resolve') $target--;
            if (isset($renamed[$parts[$target] ?? '']) && !in_array($parts[$target], array_column($config['proxy-groups'], 'name'), true)) $parts[$target] = $renamed[$parts[$target]];
            $config['rules'][$index] = implode(',', $parts);
        }
        // Replace BEFORE serializing: quotes/newlines in a brand must not corrupt YAML.
        $appName = trim(str_replace(',', '，', preg_replace('/[\x00-\x1f\x7f]/u', ' ', (string) config('v2board.app_name', 'V2Board'))));
        if ($appName === '' || in_array($appName, array_merge(['DIRECT', 'REJECT', 'GLOBAL'], $names, array_column($existing, 'name'), array_column($config['proxy-groups'], 'name')), true)) $appName = 'Proxy selection';
        array_walk_recursive($config, function (&$value) use ($appName) {
            if (is_string($value)) $value = str_replace('$app_name', $appName, $value);
        });
        return $config;
    }
}
