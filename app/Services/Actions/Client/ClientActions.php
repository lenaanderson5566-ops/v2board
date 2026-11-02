<?php

namespace App\Services\Actions\Client;


use App\Models\Plan;
use App\Services\SubscriptionClientRegistry;
use App\Services\ServerService;
use App\Services\UserService;
use App\Services\RiskLogService;
use App\Services\ClientStrategyService;
use Illuminate\Http\Request;


class ClientActions
{
    public function authenticatedConfig(Request $request)
    {
        $request->validate(['core' => 'sometimes|in:mihomo,sing-box']);
        $user = \App\Models\User::findOrFail($request->user['id']);
        $request->attributes->set('client.native', true);
        $request->attributes->set('client.version', $request->input('client_version'));
        $request->attributes->set('client.platform', $request->input('platform'));
        $strategy = new ClientStrategyService();
        if (!$strategy->isEnabled('fastai')) {
            (new RiskLogService())->createSubscribeLog($this->buildSubscribeLogPayload($request, $user, 'fastai', 'failed', 'client_disabled'));
            $this->rejectNativeConfig($request, 'CLIENT_DISABLED', 'This client is currently unavailable.');
        }
        if (!$strategy->isVersionAllowed('fastai', $request->input('client_version')) || !(new \App\Services\FastaiReleaseService())->supports($request->input('client_version'), $request->input('platform'), $request->input('architecture'))) {
            (new RiskLogService())->createSubscribeLog($this->buildSubscribeLogPayload($request, $user, 'fastai', 'failed', 'client_version_too_low'));
            $this->rejectNativeConfig($request, 'CLIENT_VERSION_TOO_LOW', 'Please update your client.', 409);
        }
        $request->merge(['user' => $user, 'format' => 'flclash', 'language' => app()->getLocale()]);
        $yaml = $this->subscribe($request);
        if ($request->input('core') === 'sing-box') {
            $configuration = json_decode($yaml->getContent(), true, 512, JSON_THROW_ON_ERROR);
            $nodes = $request->attributes->get('client.nodes', []);
            return response()->json(['data' => [
                'configVersion' => hash('sha256', json_encode([$configuration, $nodes])),
                'core' => 'sing-box',
                'coreVersion' => '1.14.3',
                'configuration' => $configuration,
                'nodes' => $nodes,
            ]], 200, [
                'X-FastAI-Config-Version' => '3',
                'Cache-Control' => 'private, no-store',
                'Vary' => 'Accept, Accept-Language',
            ]);
        }
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
        if ($request->query->has('flag') || $request->request->has('flag')) abort(422, 'The flag parameter is retired. Re-import your subscription link.');
        $this->enforceUaWhitelist($request);
        // Never render from a caller's cached account projection.
        $sourceUser = $request->user;
        $user = \App\Models\User::findOrFail($sourceUser['id']);
        if (!$request->attributes->get('client.native')) $this->assertSubscriptionIdentity($sourceUser, $user);
        $request->merge(['user' => $user]);
        $riskLogService = new RiskLogService();
        $requestedFormat = strtolower((string) $request->input('format', ''));
        $flag = $requestedFormat ?: strtolower((string) $request->userAgent());
        $resolvedClientType = null;
        $resolvedFormat = $this->resolveProtocolFormat($requestedFormat ?: $flag, $requestedFormat !== "");
        $identifiedClient = \App\Services\ClientIdentity::identify((string) $request->userAgent());
        if (!$request->attributes->get('client.native') && !SubscriptionClientRegistry::compatible((string) $identifiedClient, $resolvedFormat)) {
            $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload($request, $request->user, $resolvedFormat, 'failed', 'client_format_not_allowed'));
            abort(422, 'Subscription format '.$resolvedFormat.' is incompatible with client '.($identifiedClient ?? 'unknown').'.');
        }
        $clientStrategyService = new ClientStrategyService();
        $uaType = \App\Services\ClientIdentity::identify((string) $request->userAgent());
        $language = $this->useSubscriptionLanguage($request, $user);
        if ($user->account_deleted_at) $this->rejectUnavailableConfig();
        $clientUser = \App\Services\TrafficCreditService::forClient($user);
        // account not expired and is not banned.
        $userService = new UserService();
        if (!$user->banned) {
            $denial = $request->attributes->get('client.native') ? null : $clientStrategyService->accessDenial($resolvedFormat, (string) $request->userAgent());
            if ($request->attributes->get('client.native') ? !$clientStrategyService->isEnabled('fastai') : $denial === 'client_disabled') {
                if ($request->attributes->get('client.native')) {
                    $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload($request, $user, 'fastai', 'failed', 'client_disabled'));
                    $this->rejectNativeConfig($request, 'CLIENT_DISABLED', 'This client is currently unavailable.');
                }
                return $this->noticeResponse($request, $resolvedFormat, 'client_disabled');
            }

            if ($denial === 'client_version_too_low') {
                if ($request->attributes->get('client.native')) {
                    $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload($request, $user, 'fastai', 'failed', 'client_version_too_low'));
                    $this->rejectNativeConfig($request, 'CLIENT_VERSION_TOO_LOW', 'Please update your client.', 409);
                }
                return $this->noticeResponse($request, $resolvedFormat, 'client_version_too_low');
            }
        }

        if ($userService->canDownloadConfig($user)) {
            try {
                $serverService = new ServerService();
                $servers = $serverService->getAvailableServers($user);
                if (!$request->attributes->get('client.native')) {
                    $servers = array_values(array_filter($servers, fn ($server) =>
                        ($server['protocol'] ?? $server['type'] ?? null) !== 'naive'
                        || SubscriptionClientRegistry::supportsNaive((string) $identifiedClient, $server)));
                }

                // Template-free lists cannot supply alternative static/provider nodes.
                // Full custom templates may intentionally do so and are left intact for entitled users.
                if (!$servers && !$request->attributes->get('client.native') && $this->isNodeListFormat($resolvedFormat)) {
                    return $this->noticeResponse($request, $resolvedFormat, 'no_available_nodes');
                }

                if (!$request->attributes->get('client.native')) {
                    $servers = \App\Services\NodeDisplayService::publicServers($servers, $language);
                }
                if (!$request->attributes->get('client.native') && $resolvedFormat !== 'sing-box') {
                    $this->setSubscribeInfoToServers($servers, $user);
                }
                $class = $request->attributes->get('client.native')
                    ? ($request->input('core') === 'sing-box' ? new \App\Services\FastaiSingboxConfig($clientUser, $servers) : new \App\Services\FastaiConfig($clientUser, $servers, $this->structuredConfig($request)))
                    : $this->resolveProtocolHandler($resolvedFormat, $clientUser, $servers);
                $resolvedClientType = $request->attributes->get('client.native') ? 'fastai' : ($uaType ?: 'fastai');
                $content = $this->renderCurrentConfig($class, $user, $clientUser->group_id, $request, $resolvedFormat);
                if (($class instanceof \App\Services\FastaiConfig && $this->structuredConfig($request)) || $class instanceof \App\Services\FastaiSingboxConfig) {
                    $request->attributes->set('client.nodes', $class->nodes());
                }
                if (!$request->attributes->has('subscription.notice')) {
                    $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload($request, $user, $resolvedClientType, 'success'));
                }
                return $content;
            } catch (\Throwable $e) {
                if (!$request->attributes->get('subscription.failure.logged')) {
                    $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                        $request,
                        $user,
                        $resolvedClientType ?: $this->resolveProtocolFormat($requestedFormat ?: $flag),
                        'failed',
                        $e instanceof \Illuminate\Http\Exceptions\HttpResponseException ? 'subscription_unavailable' : $e->getMessage()
                    ));
                }
                throw $e;
            }
        }

        $reason = $this->unavailableReason($user);
        return $this->noticeResponse($request, $resolvedFormat, $reason);
    }

    public function useSubscriptionLanguage(Request $request, \App\Models\User $user): string
    {
        $language = \App\Services\Mail\ProductMail::language($request->input('language'))
            ?: \App\Services\Mail\ProductMail::language($user->language)
            ?: \App\Services\Mail\ProductMail::language(app()->getLocale()) ?: 'zh-CN';
        app()->setLocale($language);
        return $language;
    }

    public function assertSubscriptionIdentity($source, \App\Models\User $current): void
    {
        if (!$source instanceof \App\Models\User
            || !hash_equals((string)$source->uuid, (string)$current->uuid)
            || !hash_equals((string)$source->token, (string)$current->token)) $this->rejectUnavailableConfig();
    }

    public function noticeResponse(Request $request, string $format, string $reason)
    {
        (new RiskLogService())->createSubscribeLog($this->buildSubscribeLogPayload($request, $request->user, $format, 'failed', $reason));
        $request->attributes->set('subscription.failure.logged', true);
        // Native applications consume stable structured errors rather than importing warning profiles.
        if ($request->attributes->get('client.native')) $this->rejectUnavailableConfig();
        $request->attributes->set('subscription.notice', $reason);
        $copy = $this->subscriptionCopy();
        return \App\Services\SubscriptionNotice::response($format, '⚠ '.($copy[$reason] ?? $copy['user_unavailable']), $reason);
    }

    private function rejectUnavailableConfig(): never
    {
        \App\Services\SubscriptionNotice::clearExportHeaders();
        throw new \Illuminate\Http\Exceptions\HttpResponseException(
            response()->json(['code' => 'SUBSCRIPTION_UNAVAILABLE', 'message' => __('An active subscription or remaining credits are required.')], 403, ['Cache-Control'=>'private, no-store'])
        );
    }

    private function renderCurrentConfig($handler, \App\Models\User $user, ?int $groupId, Request $request, string $format)
    {
        $content = $handler->handle();
        if (!(new UserService())->isAccessSnapshotCurrent($user, $groupId)) {
            return $this->changedConfigResponse($request, $user, $format);
        }
        if (!$request->attributes->get('client.native') && $this->isNodeListFormat($format)
            && !$this->hasNodeListEntries($format, $content)) {
            return $this->noticeResponse($request, $format, 'no_available_nodes');
        }
        return $content;
    }

    public function changedConfigResponse(Request $request, \App\Models\User $user, string $format)
    {
        \App\Services\SubscriptionNotice::clearExportHeaders();
        $current = \App\Models\User::find($user->id);
        if (!$current || $current->account_deleted_at
            || !hash_equals((string)$user->uuid, (string)$current->uuid)
            || !hash_equals((string)$user->token, (string)$current->token)) $this->rejectUnavailableConfig();
        $request->merge(['user' => $current]);
        return $this->noticeResponse($request, $format, (new UserService())->canDownloadConfig($current)
            ? 'subscription_changed' : $this->unavailableReason($current));
    }

    public function enforceApplicationPolicy(Request $request): ?string
    {
        if ($request->query->has('flag') || $request->request->has('flag')) abort(422, 'The flag parameter is retired. Re-import your subscription link.');
        $this->enforceUaWhitelist($request);
        $reason = (new ClientStrategyService())->accessDenial('mihomo', (string) $request->userAgent());
        if ($reason !== null) {
            if (in_array($reason, ['client_disabled', 'client_version_too_low'], true)) return $reason;
            (new RiskLogService())->createSubscribeLog($this->buildSubscribeLogPayload($request, $request->user, 'mihomo', 'failed', $reason));
            abort(403, 'Subscription client policy rejected this request.');
        }
        return null;
    }
    public function enforceUaWhitelist(Request $request): void
    {
        $uaType = \App\Services\ClientIdentity::identify((string) $request->userAgent());
        if (!$request->attributes->get('client.native') && !$uaType) {
            (new RiskLogService())->createSubscribeLog($this->buildSubscribeLogPayload($request, $request->user, $uaType ?: 'unknown', 'failed', 'client_ua_not_allowed'));
            abort(403, 'Subscription client is not allowed.');
        }
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
            'client_type' => $request->attributes->get('client.native') ? 'fastai' : (\App\Services\ClientIdentity::identify((string) $request->userAgent()) ?: $flag),
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

    public function unavailableReason($user): string
    {
        if ($user->banned) return 'banned';
        if (\App\Services\TrafficCreditService::hasPeriod($user)
            && (int)$user->u + (int)$user->d >= (int)$user->transfer_enable) return 'traffic_exhausted';

        // Credit-only purchases also set plan_id, but never create a base allowance.
        if ($user->plan_id !== null && (int)$user->transfer_enable > 0
            && !is_null($user->expired_at) && (int) $user->expired_at <= time()) {
            return 'expired';
        }

        // Distinguish credit-only accounts from accounts that never received a product.
        $lastExpiry = \Illuminate\Support\Facades\DB::table('v2_credit_batch')->where('user_id', $user->id)->max('expires_at');
        if ($lastExpiry !== null) return (int)$lastExpiry <= time() ? 'credits_expired' : 'credits_exhausted';
        if ($user->plan_id === null) return 'no_plan';

        return 'user_unavailable';
    }

    private function isNodeListFormat(string $format): bool
    {
        return in_array($format, ['v2rayn','v2rayng','v2raytun','shadowrocket','loon','quantumult-x',
            'shadowsocks','sagernet','passwall','ssr-plus','throne','husi','nekobox'], true);
    }

    private function hasNodeListEntries(string $format, $content): bool
    {
        $body = $content instanceof \Symfony\Component\HttpFoundation\Response ? $content->getContent() : $content;
        if (!is_string($body)) return false;
        if ($format === 'shadowsocks') {
            $document = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            return !empty($document['servers']);
        }
        if ($format === 'loon') return trim($body) !== '';
        $decoded = base64_decode(trim($body), true);
        if ($decoded === false) return false;
        if ($format === 'quantumult-x') return trim($decoded) !== '';
        // Shadowrocket may emit only STATUS metadata after filtering unsupported
        // nodes. A URI list needs at least one actual connection entry.
        return preg_match('~(?:^|[\r\n])[a-z][a-z0-9+.-]*://~i', $decoded) === 1;
    }

    private function subscriptionCopy(): array
    {
        $copy = require resource_path('client/copy.php');
        return $copy[app()->getLocale()] ?? $copy['zh-CN'];
    }

    private function resolveProtocolHandler(string $resolvedFormat, $user, array $servers)
    {
        $servers = \App\Services\ClientConfigService::uniqueNames($servers, 'name', ['DIRECT', 'REJECT', 'GLOBAL', '自动选择', '故障转移', '节点选择']);
        $class = SubscriptionClientRegistry::handler($resolvedFormat);
        if (!$class) abort(422, 'Unsupported subscription format.');
        return new $class($user, $servers);
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
        if (!(int)config('fastai.show_info_to_server_enable', 0)) return;
        $names = \App\Services\SubscriptionInfo::lines($user);
        $base = $servers[0];
        foreach (array_reverse($names) as $name) {
            array_unshift($servers, array_merge($base, ['name'=>$name]));
        }
    }

    private function resolveProtocolFormat(?string $input, bool $explicit = false): string
    {
        $flag = SubscriptionClientRegistry::canonicalId((string) $input)
            ?? ($explicit ? null : \App\Services\ClientIdentity::identify((string) $input));
        if (!$flag || $flag === 'fastai') abort(422, 'Unsupported subscription format.');
        return $flag;
    }
}
