<?php

namespace App\Services;

use App\Utils\CacheKey;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

final class RegistrationEmailVerification
{
    public const MAX_ATTEMPTS = 5;
    private const WINDOW_SECONDS = 300;

    public static function attemptKey(string $email): string
    {
        return 'registration-email-proof:'.hash('sha256', EmailAddress::key($email));
    }

    public static function verify(string $email, $code, bool $v10): void
    {
        if (!is_string($code) || !preg_match('/^\d{6}$/D', $code)) {
            abort($v10 ? 409 : 500, __('Incorrect email verification code'));
        }
        $key = self::attemptKey($email);
        try {
            Cache::lock($key.':lock', 5)->block(1, function () use ($email, $code, $key, $v10) {
                if (RateLimiter::tooManyAttempts($key, self::MAX_ATTEMPTS)) {
                    abort(429, __('Too many requests, please try again later.'), ['Retry-After'=>(string)max(1, RateLimiter::availableIn($key))]);
                }
                $expected = Cache::get(CacheKey::get('EMAIL_VERIFY_CODE', strtolower(trim($email))));
                if ((!is_string($expected) && !is_int($expected)) || !preg_match('/^\d{6}$/D', (string)$expected)) {
                    abort($v10 ? 409 : 500, __('Incorrect email verification code'));
                }
                if (!hash_equals((string)$expected, $code)) {
                    RateLimiter::hit($key, self::WINDOW_SECONDS);
                    abort($v10 ? 409 : 500, __('Incorrect email verification code'));
                }
            });
        } catch (LockTimeoutException $e) {
            abort(429, __('Too many requests, please try again later.'), ['Retry-After'=>'1']);
        }
    }

    public static function consume(string $email): void
    {
        Cache::forget(CacheKey::get('EMAIL_VERIFY_CODE', strtolower(trim($email))));
        RateLimiter::clear(self::attemptKey($email));
    }
}
