<?php

namespace App\Services\Actions\Client;


use App\Models\Plan;
use App\Protocols\General;
use App\Services\ServerService;
use App\Services\UserService;
use App\Services\RiskLogService;
use App\Services\ClientStrategyService;
use Illuminate\Http\Request;
use ReflectionClass;

class ClientActions
{
    public function authenticatedConfig(Request $request)
    {
        $user = \App\Models\User::findOrFail($request->user['id']);
        $request->attributes->set('client.native', true);
        $request->attributes->set('client.version', $request->input('client_version'));
        $request->attributes->set('client.platform', $request->input('platform'));
        if (!(new \App\Services\FastaiReleaseService())->supports($request->input('client_version'), $request->input('platform'), $request->input('architecture'))) {
            $this->rejectNativeConfig($request, 'CLIENT_VERSION_TOO_LOW', 'Please update your client.', 409);
        }
        $request->merge(['user' => $user, 'flag' => 'flclash', 'language' => app()->getLocale()]);
        $yaml = $this->subscribe($request);
        if ($request->attributes->get('client.nodes') !== null) {
            $nodes = $request->attributes->get('client.nodes');
            $version = hash('sha256', $yaml.json_encode($nodes));
            return response()->json(['data'=>['configVersion'=>$version, 'yaml'=>$yaml, 'nodes'=>$nodes]], 200, ['X-FastAI-Config-Version'=>'2', 'Cache-Control'=>'private, no-store', 'Vary'=>'Accept, Accept-Language']);
        }
        return response($yaml, 200, ['Content-Type' => 'application/yaml', 'X-FastAI-Config-Version' => '1', 'Cache-Control'=>'private, no-store', 'Vary'=>'Accept, Accept-Language']);
    }

    private function structuredConfig(Request $request): bool
    {
        $accepted = \Symfony\Component\HttpFoundation\AcceptHeader::fromString((string)$request->attributes->get('v10.requestedAccept', $request->header('Accept')));
        $json = $accepted->get('application/json');
        $yaml = $accepted->get('application/yaml');
        return $json && $json->getQuality() > 0 && (!$yaml || $json->getQuality() >= $yaml->getQuality());
    }

    private function rejectNativeConfig(Request $request, string $code, string $message, int $status = 403): void
    {
        if ($request->attributes->get('client.native')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                response()->json(['code' => $code, 'message' => __($message)], $status)
            );
        }
    }

    public function subscribe(Request $request)
    {
        $riskLogService = new RiskLogService();
        $requestedFlag = strtolower((string) $request->input('flag', ''));
        $flag = $requestedFlag ?: strtolower((string) $request->userAgent());
        $resolvedClientType = null;
        $resolvedFlag = $this->resolveProtocolFlag($requestedFlag ?: $flag);
        $clientStrategyService = new ClientStrategyService();
        $user = $request->user;
        // Imported URLs pin the selected language; old client URLs use the saved preference.
        $language = \App\Services\ProductMail::language($request->input('language'))
            ?: \App\Services\ProductMail::language($user->language)
            ?: \App\Services\ProductMail::language(app()->getLocale()) ?: 'zh-CN';
        app()->setLocale($language);
        $clientUser = \App\Services\TrafficCreditService::forClient($user);
        // account not expired and is not banned.
        $userService = new UserService();
        if ($userService->isAvailable($user)) {
            if ($request->attributes->get('client.native') ? !config('v2board.fastai_enabled', 1) : !$clientStrategyService->isEnabled($resolvedFlag)) {
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedFlag,
                    'failed',
                    'client_disabled'
                ));
                $this->rejectNativeConfig($request, 'CLIENT_DISABLED', 'This client is currently unavailable.');
                $class = $this->resolveProtocolHandler($resolvedFlag, $user, $this->buildUnavailableServers('client_disabled'));
                return $class->handle();
            }

            $resolvedVersion = $request->attributes->get('client.version') ?: $clientStrategyService->resolveClientVersion(
                $resolvedFlag,
                (string) $request->input('flag', ''),
                (string) $request->header('user-agent', '')
            );
            if (!$request->attributes->get('client.native') && !$clientStrategyService->isVersionAllowed($resolvedFlag, $resolvedVersion)) {
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedFlag,
                    'failed',
                    'client_version_too_low'
                ));
                $this->rejectNativeConfig($request, 'CLIENT_VERSION_TOO_LOW', 'Please update your client.', 409);
                $class = $this->resolveProtocolHandler($resolvedFlag, $user, $this->buildUnavailableServers('client_version_too_low'));
                return $class->handle();
            }

            try {
                $serverService = new ServerService();
                $servers = $serverService->getAvailableServers($user);

                if (!$request->attributes->get('client.native')) {
                    $servers = \App\Services\NodeDisplayService::publicServers($servers, $language);
                }
                if (!$request->attributes->get('client.native') && $resolvedFlag !== 'sing') {
                    $this->setSubscribeInfoToServers($servers, $user);
                }
                $class = $request->attributes->get('client.native')
                    ? new \App\Services\FastaiConfig($clientUser, $servers, $this->structuredConfig($request))
                    : $this->resolveProtocolHandler($resolvedFlag, $clientUser, $servers);
                $resolvedClientType = $class->flag;
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedClientType,
                    'success'
                ));
                $content = $class->handle();
                if ($class instanceof \App\Services\FastaiConfig && $this->structuredConfig($request)) {
                    $request->attributes->set('client.nodes', $class->nodes());
                }
                return $content;
            } catch (\Throwable $e) {
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedClientType ?: $this->resolveProtocolFlag($requestedFlag ?: $flag),
                    'failed',
                    $e->getMessage()
                ));
                throw $e;
            }
        }

        $reason = $this->unavailableReason($user);
        $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
            $request,
            $user,
            $resolvedFlag,
            'failed',
            $reason
        ));
        $this->rejectNativeConfig($request, 'SUBSCRIPTION_UNAVAILABLE', 'No available subscription.');

        $class = $this->resolveProtocolHandler($resolvedFlag, $user, $this->buildUnavailableServers($reason));
        return $class->handle();
    }

    private function buildSubscribeLogPayload(Request $request, $user, ?string $flag, string $status, ?string $reason = null): array
    {
        $trafficU = (int) ($user['u'] ?? 0);
        $trafficD = (int) ($user['d'] ?? 0);
        $trafficTotal = (int) ($user['transfer_enable'] ?? 0);

        return [
            'user_id' => $user->id,
            'email' => $user->email,
            'plan_id' => $user->plan_id,
            'plan_name' => $user->plan_id ? optional(Plan::find($user->plan_id))->name : null,
            'expired_at' => $user->expired_at,
            'client_type' => $flag,
            'traffic_u' => $trafficU,
            'traffic_d' => $trafficD,
            'traffic_total' => $trafficTotal,
            'ip' => $request->ip(),
            'subscribe_domain' => $request->getHost(),
            'user_agent' => $request->header('user-agent'),
            'status' => $status,
            'reason' => $reason,
        ];
    }

    private function unavailableReason($user): string
    {
        if ($user->banned) return 'banned';
        // Keep classification aligned with original availability semantics.
        // New users: plan is not assigned yet.
        if (is_null($user->plan_id)) {
            return 'no_plan';
        }

        // Expired users: plan exists, and expiration timestamp is reached.
        if (!is_null($user->expired_at) && (int) $user->expired_at > 0 && (int) $user->expired_at <= time()) {
            return 'expired';
        }

        return 'user_unavailable';
    }

    private function buildUnavailableServers(string $reason): array
    {
        $copy = $this->subscriptionCopy();
        $tip = '⚠ '.($copy[$reason] ?? $copy['user_unavailable']);
        $base = [
            // Avoid localhost placeholders because some clients (e.g. Shadowrocket)
            // may silently drop loopback/private-address subscription nodes.
            'host' => '203.0.113.10',
            'type' => 'vmess',
            'network' => 'tcp',
            'network_settings' => [],
            'networkSettings' => [],
            'created_at' => time(),
            'tls' => 0,
        ];

        return [array_merge($base, ['name'=>$tip, 'port'=>61001])];
    }

    private function subscriptionCopy(): array
    {
        $copy = require resource_path('client/copy.php');
        return $copy[app()->getLocale()] ?? $copy['zh-CN'];
    }

    private function resolveProtocolHandler(string $resolvedFlag, $user, array $servers)
    {
        $servers = \App\Services\ClientConfigService::uniqueNames($servers, 'name', ['DIRECT', 'REJECT', 'GLOBAL', '自动选择', '故障转移', '节点选择']);
        foreach (array_reverse(glob(app_path('Protocols') . '/*.php')) as $file) {
            $file = 'App\\Protocols\\' . basename($file, '.php');
            $class = new $file($user, $servers);
            if (strtolower((string) $class->flag) === $resolvedFlag) {
                return $class;
            }
        }

        return new General($user, $servers);
    }

    private function subscriptionDate(int $timestamp): string
    {
        $date = \Carbon\Carbon::createFromTimestamp($timestamp, config('app.timezone', 'UTC'));
        $offset = (int)($date->getOffset() / 60);
        $zone = 'GMT';
        if ($offset !== 0) {
            $minutes = abs($offset) % 60;
            $zone .= ($offset > 0 ? '+' : '-').intdiv(abs($offset), 60);
            if ($minutes !== 0) $zone .= ':'.str_pad((string)$minutes, 2, '0', STR_PAD_LEFT);
        }
        return $date->format('Y-m-d H:i').' '.$zone;
    }

    private function setSubscribeInfoToServers(&$servers, $user)
    {
        if (!isset($servers[0])) return;
        if (!(int)config('v2board.show_info_to_server_enable', 0)) return;
        $names = \App\Services\SubscriptionInfo::lines($user);
        $base = $servers[0];
        foreach (array_reverse($names) as $name) {
            array_unshift($servers, array_merge($base, ['name'=>$name]));
        }
    }

    private function resolveProtocolFlag(?string $input): string
    {
        if (!$input) {
            return $this->getGeneralFlag();
        }

        $input = strtolower($input);
        $flags = array_values($this->getProtocolFlags());
        usort($flags, fn ($a, $b) => strlen($b) <=> strlen($a));
        foreach ($flags as $flag) {
            if (strpos($input, $flag) !== false) {
                return $flag;
            }
        }

        return $this->getGeneralFlag();
    }

    private function getGeneralFlag(): string
    {
        $defaultProperties = (new ReflectionClass(General::class))->getDefaultProperties();
        return strtolower((string) ($defaultProperties['flag'] ?? 'general'));
    }

    private function getProtocolFlags(): array
    {
        static $flags = null;
        if (!is_null($flags)) {
            return $flags;
        }

        $flags = array_keys((new ClientStrategyService())->scanProtocols());

        return array_combine($flags, $flags) ?: [];
    }

}
