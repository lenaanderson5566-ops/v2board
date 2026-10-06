<?php
use Illuminate\Http\Request;
$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$renderConsole = function (string $mode, bool $landing = false) use ($securePath) {
    $manifestPath = public_path('console/.vite/manifest.json');
    abort_unless(is_file($manifestPath), 503, '请先在 frontend 目录执行 npm ci && npm run build');
    $manifest = json_decode(file_get_contents($manifestPath), true);
    return view('console', [
        'entry' => $manifest[$mode === 'admin' ? 'admin.html' : 'index.html'],
        'boot' => \App\Support\FrontendRuntime::config($mode, $landing),
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
if (!empty(config('v2board.subscribe_path')) && trim(config('v2board.subscribe_path'), '/') !== 'api/v1/client/subscribe') {
    Route::get(config('v2board.subscribe_path'), [\App\Http\Controllers\CustomSubscriptionController::class, 'subscribe'])->middleware('client');
}
