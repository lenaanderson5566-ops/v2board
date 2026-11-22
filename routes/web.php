<?php
use App\Support\AdminPath;
use App\Support\SubscriptionPath;
use Illuminate\Http\Request;
$renderConsole = function (string $mode, bool $landing = false) {
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
Route::get('/' . AdminPath::resolve(), function () use ($renderConsole) { return $renderConsole('admin'); });
if (($subscriptionPath = SubscriptionPath::resolve()) !== null) {
    Route::get($subscriptionPath, [\App\Http\Controllers\CustomSubscriptionController::class, 'subscribe'])->middleware('client');
}
