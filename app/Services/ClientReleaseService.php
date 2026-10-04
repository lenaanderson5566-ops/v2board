<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class ClientReleaseService
{
    public const CLIENTS = [
        'clash-verge' => ['name' => 'Clash Verge Rev', 'repo' => 'clash-verge-rev/clash-verge-rev', 'platforms' => 'Windows · macOS · Linux', 'engine' => 'Mihomo'],
        'cmfa' => ['name' => 'Clash Meta for Android', 'repo' => 'MetaCubeX/ClashMetaForAndroid', 'platforms' => 'Android', 'engine' => 'Mihomo'],
        'flclash' => ['name' => 'FlClash', 'repo' => 'chen08209/FlClash', 'platforms' => 'Android · Windows · macOS · Linux', 'engine' => 'Mihomo'],
        'hiddify' => ['name' => 'Hiddify', 'repo' => 'hiddify/hiddify-app', 'platforms' => 'Android · iOS · Windows · macOS · Linux', 'engine' => 'sing-box'],
        'v2rayn' => ['name' => 'v2rayN', 'repo' => '2dust/v2rayN', 'platforms' => 'Windows · macOS · Linux', 'engine' => 'Xray / sing-box'],
        'v2rayng' => ['name' => 'v2rayNG', 'repo' => '2dust/v2rayNG', 'platforms' => 'Android', 'engine' => 'Xray'],
        'mihomo' => ['name' => 'Mihomo', 'repo' => 'MetaCubeX/mihomo', 'platforms' => '代理内核', 'engine' => 'Mihomo'],
        'sing-box' => ['name' => 'sing-box', 'repo' => 'SagerNet/sing-box', 'platforms' => '代理内核 / 官方客户端', 'engine' => 'sing-box'],
    ];

    public function all(): array
    {
        $rows = [];
        foreach (self::CLIENTS as $id => $client) {
            $state = Cache::get('client-release:' . $id, []);
            $rows[] = array_merge($client, $state, [
                'id' => $id,
                'url' => 'https://github.com/' . $client['repo'] . '/releases',
                'stale' => empty($state['checked_at']) || $state['checked_at'] < time() - 86400,
            ]);
        }
        return $rows;
    }

    // One bounded request per project. A failure preserves the last known release.
    public function check(string $id): array
    {
        abort_unless(isset(self::CLIENTS[$id]), 422, '未知客户端');
        $key = 'client-release:' . $id;
        $lock = Cache::lock($key . ':lock', 30);
        if (!$lock->get()) {
            return Cache::get($key, []);
        }
        try {
            $state = Cache::get($key, []);
            if (($state['attempted_at'] ?? 0) > time() - 300) {
                return $state;
            }
            $state['attempted_at'] = time();
            try {
                $request = Http::acceptJson()->withHeaders(['User-Agent' => 'Client-Release-Monitor'])
                    ->withOptions(['connect_timeout' => 3, 'allow_redirects' => false])->timeout(8);
                if (!empty($state['etag'])) {
                    $request = $request->withHeaders(['If-None-Match' => $state['etag']]);
                }
                $response = $request->get('https://api.github.com/repos/' . self::CLIENTS[$id]['repo'] . '/releases/latest');
                if ($response->status() !== 304) {
                    if (!$response->successful()) {
                        throw new \RuntimeException(in_array($response->status(), [403, 429])
                            ? 'GitHub 请求受限，请稍后重试' : '检查失败（HTTP ' . $response->status() . '）');
                    }
                    $data = $response->json();
                    if (!is_array($data) || empty($data['tag_name']) || !empty($data['draft']) || !empty($data['prerelease'])) {
                        throw new \RuntimeException('未获得有效的稳定版信息');
                    }
                    $tag = mb_substr((string) $data['tag_name'], 0, 100);
                    if (isset($state['version']) && $state['version'] !== $tag) {
                        $state['previous_version'] = $state['version'];
                        $state['updated_at'] = time();
                    }
                    $state['version'] = $tag;
                    $state['assets'] = array_values(array_map(function ($asset) { return array_intersect_key($asset, array_flip(['id', 'name', 'size', 'digest', 'browser_download_url'])); }, $data['assets'] ?? []));
                    $state['published_at'] = strtotime($data['published_at'] ?? '') ?: null;
                    $state['notes'] = mb_substr((string) ($data['body'] ?? ''), 0, 12000);
                    $state['etag'] = $response->header('ETag');
                } elseif (empty($state['version'])) {
                    throw new \RuntimeException('缺少版本缓存，请稍后重试');
                }
                $state['checked_at'] = time();
                $state['error'] = null;
            } catch (\Illuminate\Http\Client\ConnectionException $e) {
                $state['error'] = '连接 GitHub 超时或失败，将保留上次结果';
            } catch (\RuntimeException $e) {
                $state['error'] = $e->getMessage();
            }
            Cache::forever($key, $state);
            return $state;
        } finally {
            $lock->release();
        }
    }
}
