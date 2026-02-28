<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\App;

class Language
{
    public function handle($request, Closure $next)
    {
        $locale = $request->header('content-language');
        if (!$locale) {
            $locale = $request->query('language')
                ?: $request->query('lang')
                ?: $request->query('locale');
        }
        if (!$locale) {
            $acceptLanguage = $request->header('accept-language');
            if ($acceptLanguage) {
                $locale = explode(',', $acceptLanguage)[0];
            }
        }

        if ($locale) {
            $locale = str_replace('_', '-', trim($locale));
            if ($locale) {
                App::setLocale($locale);
            }
        }

        return $next($request);
    }
}
