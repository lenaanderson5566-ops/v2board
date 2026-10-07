<?php
namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Exceptions\HttpResponseException;

final class SessionAuthorizationCode
{
    public const APP = 'app';
    public const BROWSER = 'browser';
    public const LIFETIME = 60;

    private function key(string $purpose, string $code): string
    {
        if (!in_array($purpose, [self::APP, self::BROWSER], true)) throw new \InvalidArgumentException('Unknown authorization purpose');
        return 'SESSION_AUTHORIZATION:'.$purpose.':'.hash('sha256', $code);
    }

    private function fail(string $purpose, bool $expired): void
    {
        $code = $purpose === self::APP ? ($expired ? 'CLIENT_AUTH_EXPIRED' : 'CLIENT_AUTH_INVALID') : ($expired ? 'SESSION_LINK_EXPIRED' : 'SESSION_LINK_INVALID');
        $status = $purpose === self::APP ? ($expired ? 410 : 403) : 409;
        throw new HttpResponseException(response()->json(['code'=>$code, 'message'=>__('Token error')], $status));
    }

    public function issue(string $purpose, string $credential, array $binding = []): string
    {
        $source = AuthService::sessionReference($credential);
        $user = $source ? AuthService::sessionUser($source) : null;
        if (!$user) abort(401, __('Unauthenticated.'));
        if ($user->banned) throw new HttpResponseException(response()->json(['code'=>'ACCOUNT_BANNED', 'message'=>__('Your account has been suspended')], 403));
        $code = bin2hex(random_bytes(32));
        Cache::put($this->key($purpose, $code), ['source'=>$source, 'binding'=>$binding, 'expiresAt'=>time()+self::LIFETIME], self::LIFETIME);
        return $code;
    }

    public function exchange(string $purpose, string $code, ?callable $validateBinding = null): User
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $code)) $this->fail($purpose, true);
        $key = $this->key($purpose, $code);
        return Cache::lock($key.':lock', 5)->block(3, function () use ($key, $purpose, $validateBinding) {
            $pending = Cache::get($key);
            if (!$pending || $pending['expiresAt'] <= time()) {
                Cache::forget($key);
                $this->fail($purpose, true);
            }
            $user = AuthService::sessionUser($pending['source']);
            if (!$user) {
                Cache::forget($key);
                $this->fail($purpose, false);
            }
            if ($user->banned) {
                Cache::forget($key);
                throw new HttpResponseException(response()->json(['code'=>'ACCOUNT_BANNED', 'message'=>__('Your account has been suspended')], 403));
            }
            if ($validateBinding && !$validateBinding($pending['binding'])) $this->fail($purpose, false);
            Cache::forget($key);
            return $user;
        });
    }
}
