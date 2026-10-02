<?php
use Illuminate\Http\Request;
$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$renderConsole = function (string $mode, bool $landing = false) use ($securePath) {
    $manifestPath = public_path('console/.vite/manifest.json');
    abort_unless(is_file($manifestPath), 503, '请先在 frontend 目录执行 npm ci && npm run build');
    $manifest = json_decode(file_get_contents($manifestPath), true);
    return view('console', [
        'entry' => $manifest['src/main.tsx'],
        'boot' => [
            'mode' => $mode,
            'landing' => $landing,
            'title' => $landing ? 'Studio' : config('v2board.app_name', 'V2Board'),
            'description' => $landing ? 'A space for ideas, writing and everyday planning.' : config('v2board.app_description', '连接世界，轻松管理你的订阅。'),
            'adminPath' => $mode === 'admin' ? $securePath : '',
            'opsPath' => $mode === 'admin' ? config('v2board.ops_api_path', 'ops') : '',
            'emailVerify' => (bool) config('v2board.email_verify', 0),
            'registerClosed' => (bool) config('v2board.stop_register', 0),
            'inviteRequired' => (bool) config('v2board.invite_force', 0),
            'recaptchaSiteKey' => config('v2board.recaptcha_enable') ? (string) config('v2board.recaptcha_site_key', '') : '',
            'tosUrl' => (string) config('v2board.tos_url', ''),
            'currencySymbol' => config('v2board.currency_symbol', '¥'),
        ],
    ]);
};
Route::get('/', function (Request $request) use ($renderConsole) {
    if (config('v2board.app_url') && config('v2board.safe_mode_enable', 0)) {
        abort_if($request->getHost() !== parse_url(config('v2board.app_url'), PHP_URL_HOST), 403);
    }
    return $renderConsole('user', true);
});
Route::get('/app', function (Request $request) use ($renderConsole) {
    if (config('v2board.app_url') && config('v2board.safe_mode_enable', 0)) {
        abort_if($request->getHost() !== parse_url(config('v2board.app_url'), PHP_URL_HOST), 403);
    }
    return $renderConsole('user');
});
Route::get('/' . $securePath, function () use ($renderConsole) { return $renderConsole('admin'); });
foreach (['' => 'operations', '/overview' => 'operations', '/risk' => 'risk', '/client' => 'clients', '/logs' => 'log-login', '/i18n' => 'translations'] as $suffix => $page) {
    Route::get('/' . $securePath . '/ops-center' . $suffix, function () use ($securePath, $page) { return redirect('/' . $securePath . '#/' . $page); });
}
if (!empty(config('v2board.subscribe_path'))) {
    Route::get(config('v2board.subscribe_path'), 'V1\\Client\\ClientController@subscribe')->middleware('client');
}
