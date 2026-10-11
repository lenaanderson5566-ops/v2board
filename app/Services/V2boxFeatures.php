<?php
namespace App\Services;

use Illuminate\Validation\ValidationException;

class V2boxFeatures {
    private static function fail(string $message): void { throw ValidationException::withMessages(['sing_box'=>$message]); }
    private static function keys(array $value, array $allowed): void {
        foreach ($value as $key => $_) if (!in_array($key, $allowed, true)) self::fail('Unsupported field: '.$key);
    }
    private static function walk(array $value): void {
        foreach ($value as $key=>$v) {
            if (in_array($key, ['certificate_path','client_certificate_path','client_key_path','key_path','auth_user'], true)) self::fail('Managed or unsupported field: '.$key);
            if (is_array($v)) self::walk($v);
        }
    }
    public static function validate(array $value): void {
        if (strlen(json_encode($value)) > 262144) self::fail('Configuration exceeds 256 KiB');
        self::keys($value, ['dns','route','outbounds']);
        self::walk($value);
        foreach (['outbounds'=> $value['outbounds'] ?? [], 'dns.servers'=>$value['dns']['servers'] ?? [], 'dns.rules'=>$value['dns']['rules'] ?? [], 'route.rules'=>$value['route']['rules'] ?? [], 'route.rule_set'=>$value['route']['rule_set'] ?? []] as $path=>$items) {
            if (!is_array($items) || array_values($items) !== $items) self::fail($path.' must be an array');
            $tags = [];
            foreach ($items as $item) {
                if (!is_array($item) || array_values($item) === $item) self::fail($path.' entries must be objects');
                if (in_array($path, ['outbounds','dns.servers','route.rule_set'], true)) {
                    $tag = $item['tag'] ?? null;
                    if (!is_string($tag) || $tag === '' || isset($tags[$tag])) self::fail('Missing or duplicate tag in '.$path);
                    $tags[$tag] = true;
                }
            }
        }
        if (isset($value['dns'])) {
            if (!is_array($value['dns'])) self::fail('dns must be an object');
            self::keys($value['dns'], ['servers','rules','final','strategy','disable_cache','disable_expire','independent_cache','cache_capacity','client_subnet']);
            if (empty($value['dns']['servers']) || !is_array($value['dns']['servers'])) self::fail('dns.servers must be a nonempty array');
            foreach ($value['dns']['servers'] as $s) if (!is_array($s) || !in_array($s['type'] ?? '', ['local','udp','tcp','tls','https'], true)) self::fail('Unsupported DNS server type');
        }
        if (isset($value['route'])) {
            if (!is_array($value['route'])) self::fail('route must be an object');
            self::keys($value['route'], ['rules','rule_set','final','default_domain_resolver']);
            foreach ($value['route']['rule_set'] ?? [] as $set) {
                if (!is_array($set) || !in_array($set['type'] ?? '', ['inline','remote'], true)) self::fail('Only inline and remote rule sets are supported');
                if ($set['type'] === 'remote' && (parse_url($set['url'] ?? '', PHP_URL_SCHEME) !== 'https' || !parse_url($set['url'] ?? '', PHP_URL_HOST))) self::fail('Remote rule sets require HTTPS');
            }
        }
        $seen = ['direct'=>true];
        if (isset($value['outbounds']) && !is_array($value['outbounds'])) self::fail('outbounds must be an array');
        foreach ($value['outbounds'] ?? [] as $out) {
            if (!is_array($out) || !in_array($out['type'] ?? '', ['direct','socks','http','vmess','vless','trojan','shadowsocks','hysteria2','tuic','anytls'], true)) self::fail('Unsupported outbound type');
            $tag = $out['tag'] ?? '';
            if (!is_string($tag) || $tag === '' || isset($seen[$tag])) self::fail('Missing or duplicate/reserved outbound tag');
            $seen[$tag]=true;
        }
    }
}
