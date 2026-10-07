<?php
namespace App\Services\Actions\Passport;

use App\Services\SessionAuthorizationCode;
use App\Services\AuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

final class ClientAuthorizationActions
{
    private function fail(string $code, int $status = 409): void
    {
        throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['code'=>$code, 'message'=>'The authorization could not be completed.'], $status));
    }

    private function redirect(string $uri, string $platform): void
    {
        $valid = $platform === 'android'
            ? $uri === 'ws.fastdog.fastai://oauth/callback'
            : preg_match('#^http://127\.0\.0\.1:([0-9]{1,5})/fastai-auth/callback$#D', $uri, $match) && (int)$match[1] >= 1024 && (int)$match[1] <= 65535;
        if (!$valid || !in_array($platform, ['windows','macos','linux','android'], true)) $this->fail('INVALID_CLIENT_REDIRECT', 422);
    }

    private function key(string $kind, string $value): string
    {
        return 'FASTAI_AUTH:'.$kind.':'.hash('sha256', $value);
    }

    public function create(Request $request)
    {
        $this->redirect($request->input('redirectUri'), $request->input('platform'));
        $origin = rtrim((string)config('v2board.app_url'), '/');
        if (!filter_var($origin, FILTER_VALIDATE_URL) || parse_url($origin, PHP_URL_SCHEME) !== 'https') $this->fail('CLIENT_AUTH_UNAVAILABLE', 503);
        $id = bin2hex(random_bytes(32));
        $expires = time() + 300;
        Cache::put($this->key('request', $id), [
            'challenge'=>$request->input('codeChallenge'), 'state'=>$request->input('state'),
            'redirectUri'=>$request->input('redirectUri'), 'platform'=>$request->input('platform'), 'expiresAt'=>$expires,
        ], 300);
        return response()->json(['data'=>['authorizationId'=>$id, 'authorizationUrl'=>$origin.'/app#/client-authorize?authorizationId='.$id, 'expiresAt'=>$expires]], 201);
    }

    public function details(Request $request)
    {
        $pending = Cache::get($this->key('request', $request->input('authorization_id')));
        if (!$pending || $pending['expiresAt'] <= time()) $this->fail('CLIENT_AUTH_EXPIRED', 410);
        return response()->json(['data'=>['platform'=>$pending['platform'], 'expiresAt'=>$pending['expiresAt']]]);
    }

    public function approve(Request $request)
    {
        $key = $this->key('request', $request->input('authorization_id'));
        $result = Cache::lock($key.':lock', 5)->block(3, function () use ($key, $request) {
            $pending = Cache::get($key);
            if (!$pending || $pending['expiresAt'] <= time()) $this->fail('CLIENT_AUTH_EXPIRED', 410);
            $code = app(SessionAuthorizationCode::class)->issue(SessionAuthorizationCode::APP, $request->header('Authorization'), ['challenge'=>$pending['challenge'], 'redirectUri'=>$pending['redirectUri']]);
            Cache::forget($key);
            return $pending['redirectUri'].'?'.http_build_query(['code'=>$code, 'state'=>$pending['state']], '', '&', PHP_QUERY_RFC3986);
        });
        return response()->json(['data'=>['callbackUrl'=>$result]]);
    }

    public function exchange(Request $request)
    {
        $user = app(SessionAuthorizationCode::class)->exchange(SessionAuthorizationCode::APP, $request->input('authorizationCode'), function (array $binding) use ($request) {
            $challenge = rtrim(strtr(base64_encode(hash('sha256', $request->input('codeVerifier'), true)), '+/', '-_'), '=');
            return hash_equals($binding['challenge'], $challenge) && hash_equals($binding['redirectUri'], $request->input('redirectUri'));
        });
        $user->last_login_at = time();
        $user->last_login_ip = $request->ip() && filter_var($request->ip(), FILTER_VALIDATE_IP) ? $request->ip() : null;
        $user->save();
        $auth = (new AuthService($user))->generateAuthData($request);
        return response()->json(['data'=>$auth]);
    }
}
