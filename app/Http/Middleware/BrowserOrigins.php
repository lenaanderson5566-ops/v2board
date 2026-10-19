<?php
namespace App\Http\Middleware;

final class BrowserOrigins
{
    public static function canonical(string $url): string
    {
        $p=parse_url($url);
        if (!$p || isset($p['user']) || isset($p['pass']) || !isset($p['scheme'],$p['host'])) return '';
        $scheme=strtolower($p['scheme']);$host=strtolower($p['host']);
        if (!in_array($scheme,['http','https'],true)) return '';
        $port=$p['port'] ?? null;
        return $scheme.'://'.$host.($port!==null && $port!==($scheme==='https'?443:80) ? ':'.$port : '');
    }
    public function allows($request, ?string $origin): bool
    {
        if (!$origin || $origin === 'null') return false;
        $own = self::canonical((string)config('v2board.app_url'));
        $configured = config('cors.allowed_origins', []);
        $allowed = array_filter(array_merge([$own],$configured),fn($value)=>$value && $value!=='*');
        if (app()->environment('local')) $allowed[]=$request->getSchemeAndHttpHost();
        return in_array($origin, $allowed, true);
    }
}
