<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\App;

class Language
{
    public function handle($request, Closure $next)
    {
        $locale = $request->query('lang');
        if (!$locale) {
            $locale = $this->parseAcceptLanguage($request->header('accept-language'));
        }

        if ($locale) {
            $locale = str_replace('_', '-', trim($locale));
            if ($locale) {
                App::setLocale($locale);
            }
        }

        $response = $next($request);
        $response->headers->set('Content-Language', App::getLocale());
        return $response;
    }

    private function parseAcceptLanguage(?string $value): ?string
    {
        if (!$value) {
            return null;
        }

        $languages = [];
        foreach (explode(',', $value) as $part) {
            $part = trim($part);
            if ($part === '') {
                continue;
            }

            $segments = array_map('trim', explode(';', $part));
            $tag = $segments[0] ?? '';
            if ($tag === '') {
                continue;
            }

            $q = 1.0;
            foreach (array_slice($segments, 1) as $segment) {
                if (stripos($segment, 'q=') === 0) {
                    $qValue = (float)substr($segment, 2);
                    if ($qValue >= 0 && $qValue <= 1) {
                        $q = $qValue;
                    }
                    break;
                }
            }

            $languages[] = ['tag' => $tag, 'q' => $q];
        }

        if (!$languages) {
            return null;
        }

        usort($languages, function ($a, $b) {
            return $b['q'] <=> $a['q'];
        });

        return $languages[0]['tag'] ?? null;
    }
}
