<?php
namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class SubscriptionAccessGuard
{
    public function checkIp(Request $request): void
    {
        $this->consume('ip', (string) $request->ip(), 60, (int) config('v2board.subscription_ip_minute_limit', 120));
        $blacklist = new RiskBlacklistService();
        if ($blacklist->exists('ip', $request->ip()) || $blacklist->exists('ua_hash', hash('sha256', (string) $request->userAgent()))) {
            abort(403, 'Subscription access denied.');
        }
    }

    public function checkUser(int $userId): void
    {
        $this->consume('user-minute', (string) $userId, 60, (int) config('v2board.subscription_user_minute_limit', 30));
        $this->consume('user-day', (string) $userId, 86400, (int) config('v2board.subscription_user_day_limit', 240));
    }

    private function consume(string $scope, string $identity, int $seconds, int $limit): void
    {
        $key = 'subscription-access:'.$scope.':'.hash('sha256', $identity);
        try {
            Cache::lock($key.':lock', 5)->block(1, function () use ($key, $seconds, $limit) {
                if (RateLimiter::tooManyAttempts($key, max(1, $limit))) {
                    throw new HttpException(429, 'Too many subscription requests.', null, ['Retry-After'=>(string) max(1, RateLimiter::availableIn($key))]);
                }
                RateLimiter::hit($key, $seconds);
            });
        } catch (LockTimeoutException $e) {
            throw new HttpException(429, 'Too many concurrent subscription requests.', $e, ['Retry-After'=>'1']);
        }
    }
}
