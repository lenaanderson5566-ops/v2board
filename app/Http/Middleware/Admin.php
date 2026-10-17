<?php

namespace App\Http\Middleware;

use App\Services\AuthService;
use Closure;

class Admin
{
    /**
     * Handle an incoming request.
     *
     * @param \Illuminate\Http\Request $request
     * @param \Closure $next
     * @return mixed
     */
    public function handle($request, Closure $next)
    {
        $browser = $request->attributes->get('browser.session');
        if ($browser && $browser['scope'] !== 'admin') abort(403, __('Account is disabled.'));
        // Retain legacy POST-body credentials, but never take secrets from URLs.
        $authorization = $request->header('authorization') ?? ($request->isMethod('POST')
            ? ($request->isJson() ? $request->json('auth_data') : $request->request->get('auth_data')) : null);
        if (!$authorization) abort(403, '未登录或登陆已过期');

        $user = AuthService::decryptAuthData($authorization);
        if (!$user || !$user['is_admin'] || $user['banned']) abort(403, '未登录或登陆已过期');
        $request->merge([
            'user' => $user
        ]);
        $response = $next($request);
        $response->headers->set('Cache-Control', 'private, no-store');
        return $response;
    }
}
