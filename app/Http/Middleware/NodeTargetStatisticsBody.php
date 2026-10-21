<?php
namespace App\Http\Middleware;

use App\Services\TargetStatisticsStore;
use Closure;
use Symfony\Component\HttpFoundation\InputBag;

/** Must precede TrimStrings and other middleware that decode the request body. */
final class NodeTargetStatisticsBody
{
    public function handle($request, Closure $next)
    {
        if (!$request->isMethod('POST') || !$request->is('api/v10/server/target-statistics')) return $next($request);
        abort_unless($request->isJson() && in_array(strtolower($request->header('Content-Encoding', 'identity')), ['', 'identity'], true), 415);
        abort_if((int)$request->header('Content-Length', 0) > TargetStatisticsStore::MAX_REQUEST_BYTES, 413);
        $stream = $request->getContent(true);
        $body = stream_get_contents($stream, TargetStatisticsStore::MAX_REQUEST_BYTES + 1);
        abort_if($body === false || strlen($body) > TargetStatisticsStore::MAX_REQUEST_BYTES, 413);
        $decoded = json_decode($body, true, 32);
        abort_unless(json_last_error() === JSON_ERROR_NONE && is_array($decoded) && str_starts_with(ltrim($body), '{'), 400);
        $request->setJson(new InputBag($decoded));
        $request->attributes->set('targetStatisticsBytes', strlen($body));
        return $next($request);
    }
}
