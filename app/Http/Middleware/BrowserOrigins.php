<?php
namespace App\Http\Middleware;

final class BrowserOrigins
{
    public function allows($request, ?string $origin): bool
    {
        if (!$origin || $origin === 'null') return false;
        $canonical = rtrim((string)config('v2board.app_url'), '/');
        $parts = parse_url($canonical);
        $own = $parts && isset($parts['scheme'],$parts['host']) ? $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '') : '';
        $configured = config('cors.allowed_origins', []);
        $allowed = array_filter(array_merge([$own], $configured), fn($value)=>$value && $value !== '*');
        if (app()->environment('local')) $allowed[]=$request->getSchemeAndHttpHost();
        return in_array($origin, $allowed, true);
    }
}
