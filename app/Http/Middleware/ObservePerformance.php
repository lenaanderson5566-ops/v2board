<?php
namespace App\Http\Middleware;

use App\Services\RequestPerformance;
use Closure;

final class ObservePerformance
{
    public function handle($request, Closure $next)
    {
        $metrics=app(RequestPerformance::class);$metrics->begin();$status=500;
        try {
            $response=$next($request);$status=$response->getStatusCode();return $response;
        } catch (\Throwable $error) {
            $status=$error instanceof \Illuminate\Validation\ValidationException ? 422
                : ($error instanceof \Illuminate\Database\Eloquent\ModelNotFoundException ? 404
                : ($error instanceof \Illuminate\Http\Exceptions\HttpResponseException ? $error->getResponse()->getStatusCode()
                : (method_exists($error,'getStatusCode') ? $error->getStatusCode() : 500)));
            if ($error instanceof \Illuminate\Auth\AuthenticationException) $status=401;
            if ($error instanceof \Illuminate\Auth\Access\AuthorizationException) $status=$error->status() ?? 403;
            if ($error instanceof \Illuminate\Session\TokenMismatchException) $status=419;
            throw $error;
        } finally {
            try {$metrics->finish($request,$status);}
            catch (\Throwable $ignored) { /* Monitoring cannot change the business response. */ }
        }
    }
}
