<?php
use Illuminate\Http\Request;
$securePath = config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
$renderConsole = function (string $mode, bool $landing = false) use ($securePath) {
    $manifestPath = public_path('console/.vite/manifest.json');
    abort_unless(is_file($manifestPath), 503, '请先在 frontend 目录执行 npm ci && npm run build');
    $manifest = json_decode(file_get_contents($manifestPath), true);
    return response()->view('console', [
        'entry' => $manifest[$mode === 'admin' ? 'admin.html' : 'index.html'],
        'boot' => \App\Support\FrontendRuntime::config($mode, $landing),
    ])->header('Cache-Control', 'private, no-store');
};
Route::get('/', function (Request $request) use ($renderConsole) {
    if (config('fastai.app_url') && config('fastai.safe_mode_enable', 0)) {
        abort_if($request->getHost() !== parse_url(config('fastai.app_url'), PHP_URL_HOST), 403);
    }
    return $renderConsole('user', true);
});
Route::get('/app', function (Request $request) use ($renderConsole) {
    if (config('fastai.app_url') && config('fastai.safe_mode_enable', 0)) {
        abort_if($request->getHost() !== parse_url(config('fastai.app_url'), PHP_URL_HOST), 403);
    }
    return $renderConsole('user');
});
Route::get('/' . $securePath, function () use ($renderConsole) { return $renderConsole('admin'); });
foreach (['' => 'operations', '/overview' => 'operations', '/risk' => 'risk', '/client' => 'clients', '/logs' => 'log-login', '/i18n' => 'translations'] as $suffix => $page) {
    Route::get('/' . $securePath . '/ops-center' . $suffix, function () use ($securePath, $page) { return redirect('/' . $securePath . '#/' . $page); });
}
if (!empty(config('fastai.subscribe_path')) && trim(config('fastai.subscribe_path'), '/') !== 'api/v1/client/subscribe') {
    Route::get(config('fastai.subscribe_path'), [\App\Http\Controllers\CustomSubscriptionController::class, 'subscribe'])->middleware('client');
}
