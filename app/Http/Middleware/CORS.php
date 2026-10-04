<?php

namespace App\Http\Middleware;

use Closure;

class CORS
{
    public function handle($request, Closure $next)
    {
        $origin = $request->header('origin');
        if (empty($origin)) {
            $referer = $request->header('referer');
            if (!empty($referer) && preg_match("/^((https|http):\/\/)?([^\/]+)/i", $referer, $matches)) {
                $origin = $matches[0];
            }
        }
        $v10 = $request->is('api/v10','api/v10/*');
        $response = $v10 && $request->isMethod('OPTIONS') ? response('', 204) : $next($request);
        $response->headers->set('Access-Control-Allow-Origin', trim((string) $origin, '/'));
        $response->headers->set('Access-Control-Allow-Methods', $v10 ? 'GET,POST,PATCH,DELETE,OPTIONS,HEAD' : 'GET,POST,OPTIONS,HEAD');
        $response->headers->set('Access-Control-Allow-Headers', $v10 ? 'Origin,Content-Type,Accept,Authorization,Accept-Language,X-Request-ID,If-None-Match,X-Requested-With' : 'Origin,Content-Type,Accept,Authorization,X-Request-With');
        $response->headers->set('Access-Control-Allow-Credentials', 'true');
        $response->headers->set('Access-Control-Max-Age', 10080);
        if ($v10) {
            $response->headers->set('Access-Control-Expose-Headers', 'X-Request-ID,Content-Language,Content-Disposition,ETag');
            $response->setVary('Origin', false);
        }

        return $response;
    }
}
