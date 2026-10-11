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
            $token = (string) config('v2board.server_token');
            abort_unless($token !== '' && hash_equals($token, (string) $request->bearerToken()), 401);
            $response = $next($request);
        } catch (\Throwable $e) {
            $status = $e instanceof ValidationException ? 422 : ($e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500);
            $codes = [401 => 'NODE_UNAUTHENTICATED', 403 => 'NODE_FORBIDDEN', 404 => 'NODE_NOT_FOUND', 409 => 'NODE_CAPABILITY_REQUIRED', 422 => 'NODE_INVALID_REQUEST'];
            $response = response()->json(['type' => 'about:blank', 'title' => $codes[$status] ?? 'NODE_INTERNAL_ERROR', 'status' => $status, 'code' => $codes[$status] ?? 'NODE_INTERNAL_ERROR', 'requestId' => $id], $status, ['Content-Type' => 'application/problem+json']);
        }
        return $response->header('X-Request-Id', $id)->header('Content-Language', 'en')->header('Cache-Control', 'private, no-cache');
    }
}
