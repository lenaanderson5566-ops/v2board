<?php

namespace App\Services;

use App\Models\LoginLog;
use App\Models\SubscribeLog;

class RiskLogService
{
    public function createLoginLog(array $payload): void
    {
        $ip = $payload['ip'] ?? request()->ip();
        $geo = (new GeoIpService())->lookup($ip);

        LoginLog::create(array_merge([
            'user_id' => null,
            'email' => null,
            'ip' => $ip,
            'login_domain' => request()->getHost(),
            'user_agent' => request()->header('user-agent'),
            'is_success' => false,
            'reason' => null,
        ], $geo, $payload));
    }

    public function createSubscribeLog(array $payload): void
    {
        $ip = $payload['ip'] ?? request()->ip();
        $userAgent = $payload['user_agent'] ?? request()->header('user-agent');
        $geo = (new GeoIpService())->lookup($ip);

        SubscribeLog::create(array_merge([
            'user_id' => null,
            'email' => null,
            'plan_id' => null,
            'plan_name' => null,
            'expired_at' => null,
            'client_type' => null,
            'ip' => $ip,
            'subscribe_domain' => request()->getHost(),
            'user_agent' => $userAgent,
            'ua_hash' => $userAgent ? hash('sha256', $userAgent) : null,
            'status' => 'failed',
            'reason' => null,
        ], $geo, $payload));
    }
}
