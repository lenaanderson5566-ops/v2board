<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class NodeV10 {
    public function handle($request, Closure $next) {
        $id = $request->attributes->get('requestId') ?: (string) Str::uuid();
        try {
            \App\Services\NodeCredentials::authenticate((string)$request->bearerToken(),
                (string)$request->header('X-Node-Type'), (int)$request->header('X-Node-ID'), true);
            $response = $next($request);
        } catch (\Throwable $e) {
            $status = $e instanceof ValidationException ? 422 : ($e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500);
            $codes = [400=>'NODE_INVALID_REQUEST', 413=>'NODE_REQUEST_TOO_LARGE', 415=>'NODE_UNSUPPORTED_MEDIA_TYPE', 429=>'NODE_RATE_LIMITED', 503=>'NODE_UNAVAILABLE', 401 => 'NODE_UNAUTHENTICATED', 403 => 'NODE_FORBIDDEN', 404 => 'NODE_NOT_FOUND', 409 => 'NODE_CAPABILITY_REQUIRED', 422 => 'NODE_INVALID_REQUEST'];
            $response = response()->json(['type' => 'about:blank', 'title' => $codes[$status] ?? 'NODE_INTERNAL_ERROR', 'status' => $status, 'code' => $codes[$status] ?? 'NODE_INTERNAL_ERROR', 'requestId' => $id], $status, ['Content-Type' => 'application/problem+json'] + ($e instanceof HttpExceptionInterface ? $e->getHeaders() : []));
        }
        return $response->header('X-Request-Id', $id)->header('Content-Language', 'en')->header('Cache-Control', 'private, no-cache')->header('Vary', 'Authorization, X-Node-Type, X-Node-ID, X-Node-Capabilities');
    }
}
