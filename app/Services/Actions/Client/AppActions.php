<?php

namespace App\Services\Actions\Client;


use App\Services\ServerService;
use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Symfony\Component\Yaml\Yaml;

class AppActions
{
    public function getConfig(Request $request)
    {
        $client = new ClientActions();
        $policy = $client->enforceApplicationPolicy($request);
        $servers = [];
        $sourceUser = $request->user;
        $user = \App\Models\User::findOrFail($sourceUser['id']);
        $client->assertSubscriptionIdentity($sourceUser, $user);
        $request->merge(['user' => $user]);
        $userService = new UserService();
        $client->useSubscriptionLanguage($request, $user);
        $this->requireAvailable(!$user->account_deleted_at);
        if ($user->banned) return $client->noticeResponse($request, 'mihomo', 'banned');
        if ($policy !== null) return $client->noticeResponse($request, 'mihomo', $policy);
        if (!$userService->canDownloadConfig($user)) return $client->noticeResponse($request, 'mihomo', $client->unavailableReason($user));
        $groupId = \App\Services\TrafficCreditService::effectiveGroupId($user);
        $serverService = new ServerService();
        $servers = $serverService->getAvailableServers($user);
        $defaultConfig = base_path() . '/resources/rules/app.clash.yaml';
        $customConfig = base_path() . '/resources/rules/custom.app.clash.yaml';
        if (File::exists($customConfig)) {
            $config = Yaml::parseFile($customConfig);
        } else {
            $config = Yaml::parseFile($defaultConfig);
        }
        $proxy = [];
        $proxies = [];

        foreach ($servers as $item) {
            if ($item['type'] === 'shadowsocks'
                && in_array($item['cipher'], [
                    'aes-128-gcm',
                    'aes-192-gcm',
                    'aes-256-gcm',
                    'chacha20-ietf-poly1305'
                ])
            ) {
                array_push($proxy, \App\Protocols\ClashMeta::buildShadowsocks($user['uuid'], $item));
                array_push($proxies, $item['name']);
            }
            if ($item['type'] === 'vmess') {
                array_push($proxy, \App\Protocols\ClashMeta::buildVmess($user['uuid'], $item));
                array_push($proxies, $item['name']);
            }
            if ($item['type'] === 'trojan') {
                array_push($proxy, \App\Protocols\ClashMeta::buildTrojan($user['uuid'], $item));
                array_push($proxies, $item['name']);
            }
        }

        $config['proxies'] = array_merge($config['proxies'] ? $config['proxies'] : [], $proxy);
        foreach ($config['proxy-groups'] as $k => $v) {
            $config['proxy-groups'][$k]['proxies'] = array_merge($config['proxy-groups'][$k]['proxies'], $proxies);
        }
        $yamlContent = Yaml::dump($config);
        if (!$userService->isAccessSnapshotCurrent($user, $groupId)) return $client->changedConfigResponse($request, $user, 'mihomo');
        return response($yamlContent, 200)
            ->header('Cache-Control', 'private, no-store')
            ->header('Content-Type', 'text/yaml');
    }

    private function requireAvailable(bool $available): void
    {
        if (!$available) throw new \Illuminate\Http\Exceptions\HttpResponseException(
            response()->json(['code' => 'SUBSCRIPTION_UNAVAILABLE', 'message' => __('An active subscription or remaining credits are required.')], 403, ['Cache-Control'=>'private, no-store'])
        );
    }

    public function getVersion(Request $request)
    {
        $platform = strtolower((string)$request->header('X-Client-Platform'));
        if (!$platform) {
            $platform = 'windows';
        }

        return response([
            'data' => [
                'platform' => $platform,
                'version' => config("v2board.{$platform}_version"),
                'download_url' => config("v2board.{$platform}_download_url"),
            ]
        ]);
    }

}
