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
        $mfa = \Illuminate\Support\Facades\DB::table('v2_user_mfa')->where('user_id', $this->user->id)->first();
        $version = (int) ($mfa->version ?? 0);
        // Exchanges retain their validated version even when a concurrent change disables MFA.
        if ($request->attributes->has('mfa.verifiedVersion') || ($mfa->totp_secret ?? null) || ($mfa->email_enabled ?? false)) {
            abort_unless($request->attributes->get('mfa.verifiedUserId') === (int) $this->user->id
                && $request->attributes->get('mfa.verifiedVersion') === $version, 403, __('Security verification is required.'));
        }
        $guid = Helper::guid();
        $now = time();
        $authData = JWT::encode([
            'id' => $this->user->id,
            'session' => $guid,
            'mfaVersion' => $version,
            'iat' => $now,
            'exp' => $now + 30 * 86400,
        ], config('app.key'), 'HS256');
        $stored = self::addSession($this->user->id, $guid, [
            'ip' => $request->ip(),
            'login_at' => $now,
            'ua' => $request->userAgent(),
            'auth_data' => $authData,
            'expires_at' => $now + 30 * 86400,
            'client_kind' => $request->attributes->has('browser.session') ? 'browser' : 'native'
        ]);
        if (!$stored) throw new \RuntimeException('Session registration failed');
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
        $user = User::select(['v2_user.id', 'v2_user.email', 'v2_user.is_admin', 'v2_user.banned', 'v2_user_mfa.version as mfa_version'])
            ->leftJoin('v2_user_mfa', 'v2_user_mfa.user_id', '=', 'v2_user.id')->find($data['id']);
        if (!$user || (int)($data['mfaVersion'] ?? 0) !== (int)($user->mfa_version ?? 0)) return false;
        unset($user->mfa_version);
        return $user->toArray();
    }

    public static function sessionReference(string $jwt): ?array
    {
        $data = self::activeClaims($jwt);
        return $data ? ['userId'=>(int)$data['id'], 'sessionId'=>$data['session'], 'mfaVersion'=>(int)($data['mfaVersion'] ?? 0), 'expiresAt'=>$data['exp'] ?? null] : null;
    }

    public static function sessionUser(array $reference): ?User
    {
        if (!isset($reference['userId'], $reference['sessionId'])) return null;
        if (isset($reference['expiresAt']) && $reference['expiresAt'] <= time()) return null;
        if (!self::checkSession($reference['userId'], $reference['sessionId'])) return null;
        $user = User::select(['v2_user.*', 'v2_user_mfa.version as mfa_version'])
            ->leftJoin('v2_user_mfa', 'v2_user_mfa.user_id', '=', 'v2_user.id')->find($reference['userId']);
        if (!$user || (int)($reference['mfaVersion'] ?? 0) !== (int)($user->mfa_version ?? 0)) return null;
        unset($user->mfa_version);
        return $user;
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
        return Cache::lock($cacheKey.':lock', 10)->block(5, function () use ($cacheKey, $guid, $meta) {
            $sessions = (array)Cache::get($cacheKey, []);
            $sessions[$guid] = $meta;
            return Cache::put($cacheKey, $sessions);
        });
    }

    public function getSessions()
    {
        return array_filter((array)Cache::get(CacheKey::get("USER_SESSIONS", $this->user->id), []),
            fn($meta) => !isset($meta['expires_at']) || $meta['expires_at'] > time());
    }

    public function removeSession($sessionId)
    {
        $cacheKey = CacheKey::get("USER_SESSIONS", $this->user->id);
        if (!is_string($sessionId)) return false;
        return Cache::lock($cacheKey.':lock', 10)->block(5, function () use ($cacheKey, $sessionId) {
            $sessions = (array)Cache::get($cacheKey, []);
            if (isset($sessions[$sessionId]['auth_data'])) Cache::forget($sessions[$sessionId]['auth_data']);
            unset($sessions[$sessionId]);
            return Cache::put($cacheKey, $sessions);
        });
    }

    public function removeAllSession()
    {
        $cacheKey = CacheKey::get("USER_SESSIONS", $this->user->id);
        return Cache::lock($cacheKey.':lock', 10)->block(5, function () use ($cacheKey) {
            $sessions = (array)Cache::get($cacheKey, []);
            foreach ($sessions as $meta) {
                if (isset($meta['auth_data'])) Cache::forget($meta['auth_data']);
            }
            return Cache::forget($cacheKey);
        });
    }

    public function removeCurrentSession($jwt)
    {
        try {
            $data = (array)JWT::decode($jwt, new Key(config('app.key'), 'HS256'));
            if ((int)($data['id'] ?? 0) !== (int)$this->user->id) return false;
        } catch (\Throwable $e) {
            return false;
        }
        return $this->removeSession($data['session'] ?? null);
    }
}
