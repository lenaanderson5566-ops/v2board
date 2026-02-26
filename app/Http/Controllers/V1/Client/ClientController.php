<?php

namespace App\Http\Controllers\V1\Client;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Protocols\General;
use App\Services\ServerService;
use App\Services\UserService;
use App\Services\RiskLogService;
use App\Services\ClientStrategyService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use ReflectionClass;

class ClientController extends Controller
{
    public function subscribe(Request $request)
    {
        $riskLogService = new RiskLogService();
        $requestedFlag = strtolower((string) $request->input('flag', ''));
        $flag = $requestedFlag ?: strtolower((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
        $resolvedClientType = null;
        $resolvedFlag = $this->resolveProtocolFlag($requestedFlag ?: $flag);
        $clientStrategyService = new ClientStrategyService();
        $user = $request->user;
        // account not expired and is not banned.
        $userService = new UserService();
        if ($userService->isAvailable($user)) {
            if (!$clientStrategyService->isEnabled($resolvedFlag)) {
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedFlag,
                    'failed',
                    'client_disabled'
                ));
                $class = $this->resolveProtocolHandler($resolvedFlag, $user, $this->buildUnavailableServers('client_disabled'));
                return $class->handle();
            }

            $resolvedVersion = $clientStrategyService->resolveClientVersion(
                $resolvedFlag,
                (string) $request->input('flag', ''),
                (string) $request->header('user-agent', '')
            );
            if (!$clientStrategyService->isVersionAllowed($resolvedFlag, $resolvedVersion)) {
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedFlag,
                    'failed',
                    'client_version_too_low'
                ));
                $class = $this->resolveProtocolHandler($resolvedFlag, $user, $this->buildUnavailableServers('client_version_too_low'));
                return $class->handle();
            }

            try {
                $serverService = new ServerService();
                $servers = $serverService->getAvailableServers($user);

                if ($resolvedFlag !== 'sing') {
                    $this->setSubscribeInfoToServers($servers, $user);
                }
                $class = $this->resolveProtocolHandler($resolvedFlag, $user, $servers);
                $resolvedClientType = $class->flag;
                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                    $request,
                    $user,
                    $resolvedClientType,
                    'success'
                ));
                return $class->handle();
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
        $tipMap = [
            'no_plan' => [
                'en' => '⚠ No active plan',
                'ja' => '⚠ 有効なプランなし',
                'ko' => '⚠ 활성 플랜 없음',
                'zh' => '⚠ 暂无有效套餐',
            ],
            'expired' => [
                'en' => '⚠ Plan expired',
                'ja' => '⚠ プラン期限切れ',
                'ko' => '⚠ 플랜 만료됨',
                'zh' => '⚠ 套餐已过期',
            ],
            'user_unavailable' => [
                'en' => '⚠ Subscription unavailable',
                'ja' => '⚠ 購読は利用不可',
                'ko' => '⚠ 구독 사용 불가',
                'zh' => '⚠ 订阅暂不可用',
            ],
            'client_disabled' => [
                'en' => '⚠ Client type disabled by administrator',
                'ja' => '⚠ 管理者によりクライアント種別が無効化されています',
                'ko' => '⚠ 관리자에 의해 클라이언트 유형이 비활성화되었습니다',
                'zh' => '⚠ 该客户端类型已被管理员禁用',
            ],
            'client_version_too_low' => [
                'en' => '⚠ Client version is lower than required minimum',
                'ja' => '⚠ クライアントのバージョンが最低要件を満たしていません',
                'ko' => '⚠ 클라이언트 버전이 최소 요구 버전보다 낮습니다',
                'zh' => '⚠ 客户端版本低于最低要求，请升级客户端',
            ],
        ];

        $tips = $tipMap[$reason] ?? $tipMap['user_unavailable'];
        $base = [
            // Avoid localhost placeholders because some clients (e.g. Shadowrocket)
            // may silently drop loopback/private-address subscription nodes.
            'host' => '203.0.113.10',
            'type' => 'vmess',
            'network' => 'tcp',
            'network_settings' => [],
            'created_at' => time(),
            'tls' => 0,
        ];

        return [
            array_merge($base, [
                'name' => $tips['en'],
                'port' => 61001,
            ]),
            array_merge($base, [
                'name' => $tips['ja'],
                'port' => 61002,
            ]),
            array_merge($base, [
                'name' => $tips['ko'],
                'port' => 61003,
            ]),
            array_merge($base, [
                'name' => $tips['zh'],
                'port' => 61004,
            ]),
        ];
    }

    private function resolveProtocolHandler(string $resolvedFlag, $user, array $servers)
    {
        foreach (array_reverse(glob(app_path('Protocols') . '/*.php')) as $file) {
            $file = 'App\\Protocols\\' . basename($file, '.php');
            $class = new $file($user, $servers);
            if (strtolower((string) $class->flag) === $resolvedFlag) {
                return $class;
            }
        }

        return new General($user, $servers);
    }

    private function setSubscribeInfoToServers(&$servers, $user)
    {
        if (!isset($servers[0])) return;
        if (!(int)config('v2board.show_info_to_server_enable', 0)) return;
        $useTraffic = $user['u'] + $user['d'];
        $totalTraffic = $user['transfer_enable'];
        $remainingTraffic = Helper::trafficConvert($totalTraffic - $useTraffic);
        $expiredDate = $user['expired_at'] ? date('Y-m-d', $user['expired_at']) : '长期有效';
        $userService = new UserService();
        $resetDay = $userService->getResetDay($user);
        array_unshift($servers, array_merge($servers[0], [
            'name' => "套餐到期：{$expiredDate}",
        ]));
        if ($resetDay) {
            array_unshift($servers, array_merge($servers[0], [
                'name' => "距离下次重置剩余：{$resetDay} 天",
            ]));
        }
        array_unshift($servers, array_merge($servers[0], [
            'name' => "剩余流量：{$remainingTraffic}",
        ]));
    }

    private function resolveProtocolFlag(?string $input): string
    {
        if (!$input) {
            return $this->getGeneralFlag();
        }

        $input = strtolower($input);
        foreach ($this->getProtocolFlags() as $flag) {
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
