<?php

namespace App\Http\Controllers\V1\Client;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Protocols\General;
use App\Protocols\Singbox\Singbox;
use App\Protocols\Singbox\SingboxOld;
use App\Protocols\ClashMeta;
use App\Services\ServerService;
use App\Services\UserService;
use App\Services\RiskLogService;
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
        $user = $request->user;
        // account not expired and is not banned.
        $userService = new UserService();
        if ($userService->isAvailable($user)) {
            try {
                $serverService = new ServerService();
                $servers = $serverService->getAvailableServers($user);
                if($flag) {
                    if (!strpos($flag, 'sing')) {
                        $this->setSubscribeInfoToServers($servers, $user);
                        foreach (array_reverse(glob(app_path('Protocols') . '/*.php')) as $file) {
                            $file = 'App\\Protocols\\' . basename($file, '.php');
                            $class = new $file($user, $servers);
                            if (strpos($flag, $class->flag) !== false) {
                                $resolvedClientType = $class->flag;
                                $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                                    $request,
                                    $user,
                                    $resolvedClientType,
                                    'success'
                                ));
                                return $class->handle();
                            }
                        }
                    }
                    if (strpos($flag, 'sing') !== false) {
                        $version = null;
                        if (preg_match('/sing-box\s+([0-9.]+)/i', $flag, $matches)) {
                            $version = $matches[1];
                        }
                        if (!is_null($version) && $version >= '1.12.0') {
                            $class = new Singbox($user, $servers);
                        } else {
                            $class = new SingboxOld($user, $servers);
                        }
                        $resolvedClientType = $class->flag;
                        $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
                            $request,
                            $user,
                            $resolvedClientType,
                            'success'
                        ));
                        return $class->handle();
                    }
                }
                $class = new General($user, $servers);
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

        $riskLogService->createSubscribeLog($this->buildSubscribeLogPayload(
            $request,
            $user,
            $this->resolveProtocolFlag($requestedFlag ?: $flag),
            'failed',
            'user_unavailable'
        ));

        abort(403, 'user is not available');
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

        $flags = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(app_path('Protocols'))
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $relativePath = str_replace(app_path() . DIRECTORY_SEPARATOR, '', $file->getPathname());
            $class = 'App\\' . str_replace([DIRECTORY_SEPARATOR, '.php'], ['\\', ''], $relativePath);
            if (!class_exists($class)) {
                continue;
            }

            $defaultProperties = (new ReflectionClass($class))->getDefaultProperties();
            $flag = strtolower((string) ($defaultProperties['flag'] ?? ''));
            if ($flag) {
                $flags[$flag] = $flag;
            }
        }

        return $flags;
    }
}
