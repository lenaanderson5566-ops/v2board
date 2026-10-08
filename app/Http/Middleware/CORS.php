<?php

namespace App\Http\Middleware;

use Closure;

class CORS
{
    public function handle($request, Closure $next)
    {
        $origin = $request->header('Origin');
        $allowed = app(BrowserOrigins::class)->allows($request, $origin);
        $v10 = $request->is('api/v10','api/v10/*');
        $response = $request->is('api/*') && $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
        if ($allowed) $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Methods', $v10 ? 'GET,POST,PATCH,DELETE,OPTIONS,HEAD' : 'GET,POST,OPTIONS,HEAD');
        $response->headers->set('Access-Control-Allow-Headers', $v10 ? 'Origin,Content-Type,Accept,Authorization,Accept-Language,X-Request-ID,If-None-Match,X-Requested-With,X-Browser-Client,X-CSRF-Token' : 'Origin,Content-Type,Accept,Authorization,Accept-Language,Content-Language,X-Requested-With,X-Request-With,X-Browser-Client,X-CSRF-Token');
        if ($allowed) $response->headers->set('Access-Control-Allow-Credentials', 'true');
        if ($request->attributes->has('browser.session')) $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Access-Control-Max-Age', 10080);
        $response->setVary('Origin', false);
        $response->headers->set('Access-Control-Expose-Headers', 'X-Request-ID,Content-Language,Content-Disposition,ETag,X-CSRF-Token');

        return $response;
    }
}
