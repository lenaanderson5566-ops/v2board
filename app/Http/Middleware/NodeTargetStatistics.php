<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\RateLimiter;

/** Authenticated node identity owns the quota, independent of its source IP. */
final class NodeTargetStatistics
{
    public function handle($request, Closure $next)
    {
        $id = (string)$request->header('X-Node-ID');
        abort_unless($request->header('X-Node-Type') === 'v2box' && ctype_digit($id)
            && filter_var($id, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]) !== false, 422);
        $key = 'target-ingest:v2:v2box:'.(int)$id;
        abort_if(RateLimiter::tooManyAttempts($key, 30), 429, 'Statistics rate limited',
            ['Retry-After'=>(string)RateLimiter::availableIn($key)]);
        RateLimiter::hit($key, 60);
        return $next($request);
    }
}
