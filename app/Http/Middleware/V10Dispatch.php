<?php
namespace App\Http\Middleware;
use Closure;
class V10Dispatch
{
    public function handle($request, Closure $next)
    {
        return $request->is('api/v10','api/v10/*') ? app(V10::class)->handle($request,$next) : $next($request);
    }
}
