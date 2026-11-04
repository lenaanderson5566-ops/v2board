<?php

namespace App\Services;

use App\Utils\Helper;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

final class OneTimeSubscriptionToken
{
    private const TTL = 86400;

    public static function issue(string $accountToken): string
    {
        return self::locked($accountToken, function () use ($accountToken) {
            $index = 'otp_'.$accountToken;
            $current = Cache::get($index);
            if (is_string($current) && Cache::get('otpn_'.$current) === $accountToken) return $current;

            $token = Helper::base64EncodeUrlSafe(random_bytes(24));
            $key = 'otpn_'.$token;
            abort_unless(Cache::put($key, $accountToken, self::TTL), 503, 'Subscription link could not be issued.');
            if (!Cache::put($index, $token, self::TTL)) {
                Cache::forget($key);
                abort(503, 'Subscription link could not be issued.');
            }
            return $token;
        });
    }

    public static function consume(string $token): string
    {
        $key = 'otpn_'.$token;
        $accountToken = Cache::get($key);
        abort_unless(is_string($accountToken) && $accountToken !== '', 403, 'token is error');

        return self::locked($accountToken, function () use ($token, $key, $accountToken) {
            abort_unless(Cache::get($key) === $accountToken && Cache::forget($key), 403, 'token is error');
            $index = 'otp_'.$accountToken;
            if (Cache::get($index) === $token) Cache::forget($index);
            return $accountToken;
        });
    }

    private static function locked(string $accountToken, callable $action): string
    {
        try {
            return Cache::lock('subscription-one-time:'.hash('sha256', $accountToken), 10)->block(2, $action);
        } catch (LockTimeoutException $exception) {
            abort(429, 'Too many concurrent subscription requests.', ['Retry-After'=>'1']);
        }
    }
}
