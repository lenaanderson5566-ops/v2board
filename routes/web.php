<?php

use App\Services\ThemeService;
use Illuminate\Http\Request;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/', function (Request $request) {
    if (config('v2board.app_url') && config('v2board.safe_mode_enable', 0)) {
        if ($request->server('HTTP_HOST') !== parse_url(config('v2board.app_url'))['host']) {
            abort(403);
        }
    }
    $renderParams = [
        'title' => config('v2board.app_name', 'V2Board'),
        'theme' => config('v2board.frontend_theme', 'default'),
        'version' => config('app.version'),
        'description' => config('v2board.app_description', 'V2Board is best'),
        'logo' => config('v2board.logo')
    ];

    if (!config("theme.{$renderParams['theme']}")) {
        $themeService = new ThemeService($renderParams['theme']);
        $themeService->init();
    }

    $renderParams['theme_config'] = config('theme.' . config('v2board.frontend_theme', 'default'));
    return view('theme::' . config('v2board.frontend_theme', 'default') . '.dashboard', $renderParams);
});

$securePath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
$adminExtensionPath = $securePath . '/admin-extension';

//TODO:: 兼容
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

Route::get('/' . $adminExtensionPath, function () use ($securePath, $adminExtensionPath) {
    return view('admin-extension', [
        'secure_path' => $securePath,
        'admin_extension_path' => $adminExtensionPath
    ]);
});


Route::get('/' . $securePath . '/addon', function () use ($adminExtensionPath) {
    return redirect('/' . $adminExtensionPath);
});

Route::get('/' . $adminExtensionPath . '/plan-i18n', function () use ($securePath) {
    return view('plan-i18n', [
        'secure_path' => $securePath
    ]);
});

$riskView = function () {
    return view('risk', [
        'title' => config('v2board.app_name', 'V2Board'),
        'api_path' => config('v2board.risk_control_api_path', 'risk-control')
    ]);
};

Route::get('/' . $adminExtensionPath . '/risk-control', $riskView);

// legacy urls -> unified extension page
Route::get('/' . $securePath . '/plan-i18n', function () use ($adminExtensionPath) {
    return redirect('/' . $adminExtensionPath . '#plan-i18n');
});

Route::get('/' . $securePath . '/risk-control', function () use ($adminExtensionPath) {
    return redirect('/' . $adminExtensionPath . '#risk-control');
});

if (!empty(config('v2board.subscribe_path'))) {
    Route::get(config('v2board.subscribe_path'), 'V1\\Client\\ClientController@subscribe')->middleware('client');
}
