<?php

use App\Services\ThemeService;
use Illuminate\Http\Request;

Route::get('/', function (Request $request) {
    if (config('v2board.app_url') && config('v2board.safe_mode_enable', 0)) {
        if ($request->server('HTTP_HOST') !== parse_url(config('v2board.app_url'))['host']) {
            abort(403);
        }
    }
    $configuredTheme = config('v2board.frontend_theme', 'd1');
    $resolvedTheme = $configuredTheme;
    if ($configuredTheme === 'default' && !file_exists(public_path("t1/{$configuredTheme}/dashboard.blade.php"))) {
        $resolvedTheme = 'd1';
    }

    $renderParams = [
        'title' => config('v2board.app_name', 'V2Board'),
        'theme' => $resolvedTheme,
        'version' => config('app.version'),
        'description' => config('v2board.app_description', 'V2Board is best'),
        'logo' => config('v2board.logo')
    ];

    if (!config("theme.{$renderParams['theme']}")) {
        $themeService = new ThemeService($renderParams['theme']);
        $themeService->init();
    }

    $renderParams['theme_config'] = config("theme.{$resolvedTheme}");
    return view("theme::{$resolvedTheme}.dashboard", $renderParams);
});

$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$opsPath = $securePath . '/ops-center';

Route::get('/' . $securePath, function () use ($securePath) {
    return view('admin', [
        'title' => config('v2board.app_name', 'V2Board'),
        'theme_sidebar' => config('v2board.frontend_theme_sidebar', 'light'),
        'theme_header' => config('v2board.frontend_theme_header', 'dark'),
        'theme_color' => config('v2board.frontend_theme_color', 'default'),
        'background_url' => config('v2board.frontend_background_url'),
        'version' => config('app.version'),
        'logo' => config('v2board.logo'),
        'secure_path' => $securePath
    ]);
});

Route::get('/' . $opsPath, function () use ($securePath, $opsPath) {
    return view('admin-extension', [
        'secure_path' => $securePath,
        'ops_path' => $opsPath
    ]);
});

Route::get('/' . $opsPath . '/i18n', function () use ($securePath, $opsPath) {
    return view('i18n-center', [
        'secure_path' => $securePath,
        'ops_path' => $opsPath
    ]);
});



Route::get('/' . $opsPath . '/overview', function () {
    return view('ops.overview-center');
});

Route::get('/' . $opsPath . '/risk', function () {
    return view('ops.risk-center');
});

Route::get('/' . $opsPath . '/client', function () {
    return view('ops.client-center');
});

Route::get('/' . $opsPath . '/logs', function () {
    return view('ops.log-center');
});

if (!empty(config('v2board.subscribe_path'))) {
    Route::get(config('v2board.subscribe_path'), 'V1\\Client\\ClientController@subscribe')->middleware('client');
}
