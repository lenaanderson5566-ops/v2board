<?php
namespace App\Services;

use Illuminate\Http\Request;

final class BrowserLoginLink
{
    public function create(Request $request, string $credential): string
    {
        $redirect = $request->input('redirect') ?: 'dashboard';
        if (!is_string($redirect) || !preg_match('/^[a-z0-9-]+$/D', $redirect)) abort(422, __('Please check the format and allowed range of this value.'));
        $origin = rtrim((string)(config('v2board.app_url') ?: url('/')), '/');
        $parts = parse_url($origin);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) abort(503, __('The service could not complete the request.'));
        $code = app(SessionAuthorizationCode::class)->issue(SessionAuthorizationCode::BROWSER, $credential);
        return $origin.'/#/login?'.http_build_query(['verify'=>$code, 'redirect'=>$redirect], '', '&', PHP_QUERY_RFC3986);
    }
}
