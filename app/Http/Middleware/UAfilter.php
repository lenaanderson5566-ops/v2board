<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class UAfilter
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle(Request $request, Closure $next)
    {
        if ($request->is('api/v10','api/v10/*')) return $next($request);
        if (strpos($request->header('User-Agent'), 'MicroMessenger') !== false || strpos($request->header('User-Agent'), 'QQ/') !== false) {
            $language = 'zh-CN';
            foreach ($request->getLanguages() as $candidate) {
                $matched = \App\Services\Mail\ProductMail::language($candidate);
                if ($matched) { $language = $matched; break; }
            }
            $heading = e(__('Unsupported browser', [], $language));
            $description = e(__('This page cannot be opened in the WeChat or QQ browser.', [], $language));
            $instruction = e(__('Open the menu in the top right and choose to open in your browser.', [], $language));
            $direction = $language === 'fa-IR' ? 'rtl' : 'ltr';
            $html = <<<HTML
<!DOCTYPE html>
<html lang="{$language}" dir="{$direction}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{$heading}</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #333; }
        p { color: #666; }
    </style>
</head>
<body>
    <h1>{$heading}</h1>
    <p>{$description}</p>
    <p>{$instruction}</p>
</body>
</html>
HTML;
            return response($html, 200)->header('Content-Type', 'text/html')->header('Content-Language', $language);
        }

        if (strpos($request->header('User-Agent'), 'python-requests')) {
            return response('', 200);
        }

        return $next($request);
    }
}
