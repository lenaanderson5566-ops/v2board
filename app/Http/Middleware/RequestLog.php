<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Support\Str;
class RequestLog
{
    public function handle($request, Closure $next)
    {
        $start = microtime(true);
        $id = (string) Str::uuid();
        $status = 500;
        try {
            $response = $next($request);
            $status = $response->getStatusCode();
            $response->headers->set('X-Request-ID', $id);
            return $response;
        } catch (\Throwable $error) {
            $status = $error instanceof \Illuminate\Validation\ValidationException ? 422 : (method_exists($error, 'getStatusCode') ? $error->getStatusCode() : 500);
            throw $error;
        } finally {
            if (!$request->isMethod('GET')) info('Admin operation', ['requestId'=>$id, 'route'=>$request->route() ? $request->route()->uri() : 'unmatched', 'method'=>$request->method(), 'status'=>$status, 'durationMs'=>(int)round((microtime(true)-$start)*1000)]);
        }
    }
}
