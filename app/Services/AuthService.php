<?php

namespace App\Services;

use App\Utils\CacheKey;
use App\Utils\Helper;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;

class AuthService
{
    private $user;

    public function __construct(User $user)
    {
        $this->user = $user;
    }

    public function generateAuthData(Request $request)
    {
        $guid = Helper::guid();
        $now = time();
        $authData = JWT::encode([
            'id' => $this->user->id,
            'session' => $guid,
            'iat' => $now,
            'exp' => $now + 30 * 86400,
        ], config('app.key'), 'HS256');
        self::addSession($this->user->id, $guid, [
            'ip' => $request->ip(),
            'login_at' => $now,
            'ua' => $request->userAgent(),
            'auth_data' => $authData
        ]);
        return [
            'token' => $this->user->token,
            'is_admin' => $this->user->is_admin,
            'auth_data' => $authData
        ];
    }

    private static function activeClaims($jwt): ?array
    {
        try {
            if (!is_string($jwt) || $jwt === '') return null;
            $data = (array)JWT::decode($jwt, new Key(config('app.key'), 'HS256'));
            if (!isset($data['id'], $data['session']) || !is_numeric($data['id']) || !is_string($data['session'])) return null;
            if (!self::checkSession($data['id'], $data['session'])) return null;
            return $data;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public static function decryptAuthData($jwt)
    {
        $data = self::activeClaims($jwt);
        if (!$data) return false;
        $user = User::select(['id', 'email', 'is_admin', 'is_staff', 'banned'])->find($data['id']);
        return $user ? $user->toArray() : false;
    }

    public static function sessionReference(string $jwt): ?array
    {
        $data = self::activeClaims($jwt);
        return $data ? ['userId'=>(int)$data['id'], 'sessionId'=>$data['session'], 'expiresAt'=>$data['exp'] ?? null] : null;
    }

    public static function sessionUser(array $reference): ?User
    {
        if (!isset($reference['userId'], $reference['sessionId'])) return null;
        if (isset($reference['expiresAt']) && $reference['expiresAt'] <= time()) return null;
        if (!self::checkSession($reference['userId'], $reference['sessionId'])) return null;
        return User::find($reference['userId']);
    }

    private static function checkSession($userId, $session)
    {
        $sessions = (array)Cache::get(CacheKey::get("USER_SESSIONS", $userId)) ?? [];
        if (!in_array($session, array_keys($sessions))) return false;
        return true;
    }

    private static function addSession($userId, $guid, $meta)
    {
        $cacheKey = CacheKey::get("USER_SESSIONS", $userId);
        $sessions = (array)Cache::get($cacheKey, []);
        $sessions[$guid] = $meta;
        if (!Cache::put(
            $cacheKey,
            $sessions
        )) return false;
        return true;
    }

    public function getSessions()
    {
        return (array)Cache::get(CacheKey::get("USER_SESSIONS", $this->user->id), []);
    }

    public function removeSession($sessionId)
    {
        $cacheKey = CacheKey::get("USER_SESSIONS", $this->user->id);
        $sessions = (array)Cache::get($cacheKey, []);
        if (!is_string($sessionId)) return false;
        if (isset($sessions[$sessionId]['auth_data'])) Cache::forget($sessions[$sessionId]['auth_data']);
        unset($sessions[$sessionId]);
        if (!Cache::put(
            $cacheKey,
            $sessions
        )) return false;
        return true;
    }

    public function removeAllSession()
    {
        $cacheKey = CacheKey::get("USER_SESSIONS", $this->user->id);
        $sessions = (array)Cache::get($cacheKey, []);
        foreach ($sessions as $guid => $meta) {
            if (isset($meta['auth_data'])) {
                Cache::forget($meta['auth_data']);
            }
        }
        return Cache::forget($cacheKey);
    }

    public function removeCurrentSession($jwt)
    {
        try {
            $data = (array)JWT::decode($jwt, new Key(config('app.key'), 'HS256'));
            if ((int)($data['id'] ?? 0) !== (int)$this->user->id) return false;
            return $this->removeSession($data['session'] ?? null);
        } catch (\Throwable $e) {
            return false;
        }
    }
}
