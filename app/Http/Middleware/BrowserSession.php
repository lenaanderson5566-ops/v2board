<?php
namespace App\Http\Middleware;

use Closure;
use App\Services\AuthService;
use App\Services\BrowserSession as Sessions;

final class BrowserSession
{
    public function handle($request, Closure $next)
    {
        $scope = $request->header('X-Browser-Client');
        if (!in_array($scope, ['user','admin'], true)) return $next($request);
        // Native protocols never participate in browser cookie authentication.
        if (!$request->is('api/v10/*','api/v1/*')) return $next($request);
        if ($request->is('api/v10/public/*','api/v10/subscriptions/*','api/v10/webhooks/*')) return $next($request);
        if ($request->is('api/v1/guest/*','api/v1/client/*','api/v1/server/*')) return $next($request);
        $sessions = app(Sessions::class);
        $record = $sessions->load($request, $scope);
        $request->attributes->set('browser.session', $record);
        if (!$request->isMethod('GET') && !$request->isMethod('HEAD') && !$request->isMethod('OPTIONS')) {
            $origin = $request->header('Origin');
            $allowed = app(BrowserOrigins::class)->allows($request, $origin);
            if (!$allowed || !is_string($request->header('X-CSRF-Token')) || !hash_equals($record['csrfToken'], $request->header('X-CSRF-Token'))) {
                return response()->json(['code'=>'CSRF_INVALID', 'message'=>'Refresh the page and try again.'], 419, ['Cache-Control'=>'private, no-store']);
            }
        }
        // Browser callers cannot choose a token from query, body or Authorization.
        $request->headers->remove('Authorization');
        $request->query->remove('auth_data');
        $request->request->remove('auth_data');
        if ($request->isJson()) $request->json()->remove('auth_data');
        if ($record['credential']) $request->headers->set('Authorization', $request->is('api/v10/*') ? 'Bearer '.$record['credential'] : $record['credential']);
        $response = $next($request);
        $record = $request->attributes->get('browser.session');
        $grant = $request->isMethod('POST') && $request->is('api/v10/auth/sessions','api/v10/auth/accounts','api/v10/auth/session-exchanges','api/v10/auth/client-session-exchanges','api/v1/passport/auth/login','api/v1/passport/auth/register');
        $payload = $grant && $response->isSuccessful() ? json_decode($response->getContent(), true) : null;
        $credential = $payload['data']['accessToken'] ?? $payload['data']['auth_data'] ?? null;
        if ($grant && $response->isSuccessful() && is_string($credential) && AuthService::decryptAuthData($credential)) {
            $user = AuthService::decryptAuthData($credential);
            if ($scope === 'admin' && (!$user['is_admin'] || $user['banned'])) {
                (new AuthService(\App\Models\User::findOrFail($user['id'])))->removeCurrentSession($credential);
                return response()->json(['code'=>'FORBIDDEN','message'=>__('Account is disabled.')],403);
            }
            $sessions->destroy($record);
            $record = $sessions->rotate($record, $credential);
            $payload['data'] = $sessions->projection($record);
            $response->setContent(json_encode($payload));
        }
        if ($record['credential'] && !AuthService::decryptAuthData($record['credential'])) {
            $sessions->destroy($record);
            $record['credential'] = '';
            $record['expiresAt'] = time()+600;
            // An older in-flight response must not overwrite a newer login cookie.
            $record['changed'] = false;
        }
        $sessions->persist($record, $response);
        return $response;
    }
}
