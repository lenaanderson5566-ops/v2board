<?php
namespace App\Services;

final class ClientMirrorPolicy
{
    public static function reason(string $client, string $version, array $policies): ?string
    {
        $id = ['clash-verge'=>'clash', 'sing-box'=>'singbox'][$client] ?? $client;
        $policy = $policies[$id] ?? [];
        if (($policy['enabled'] ?? true) === false) return '客户端策略已禁用，不能自动下载或上架';
        if (!empty($policy['engineMinVersion'])) return '已设置 Mihomo 最低版本，需人工确认安装包内核版本';
        $min = $policy['minVersion'] ?? null;
        // CMFA tags identify the application, not its embedded Mihomo engine.
        if ($client === 'cmfa' && $min) return '已设置 Mihomo 最低版本，需人工确认安装包内核版本';
        if ($min) {
            if (ClientIdentity::normalizeVersion($version) === null || ClientIdentity::normalizeVersion($min) === null) return '版本无法可靠比较，请人工确认';
            if (!ClientIdentity::allowsVersion($min, $version)) return '官方安装包低于客户端策略要求的最低版本';
        }
        return null;
    }
}
