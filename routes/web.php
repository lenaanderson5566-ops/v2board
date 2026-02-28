<?php

use App\Services\ThemeService;
use Illuminate\Http\Request;

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

Route::get('/' . $securePath . '/addon', function () use ($opsPath) {
    return redirect('/' . $opsPath);
});

Route::get('/' . $opsPath . '/i18n', function () use ($securePath, $opsPath) {
    return view('i18n-center', [
        'secure_path' => $securePath,
        'ops_path' => $opsPath
    ]);
});

Route::get('/' . $opsPath . '/plan-i18n', function () use ($opsPath) {
    return redirect('/' . $opsPath . '/i18n');
});

Route::get('/' . $opsPath . '/marketing-email', function () use ($opsPath) {
    return view('module-placeholder', [
        'title' => '营销邮件模块（占位）',
        'description' => '该模块用于营销邮件模板、分群发送、自动化触达等能力，当前为功能占位。',
        'ops_path' => $opsPath,
    ]);
});

Route::get('/' . $opsPath . '/user-points', function () use ($opsPath) {
    return view('module-placeholder', [
        'title' => '用户积分模块（占位）',
        'description' => '该模块用于积分规则、积分流水、积分兑换等能力，当前为功能占位。',
        'ops_path' => $opsPath,
    ]);
});

$riskView = function () {
    return view('risk', [
        'title' => config('v2board.app_name', 'V2Board'),
        'api_path' => config('v2board.risk_control_api_path', 'risk-control')
    ]);
};

Route::get('/' . $opsPath . '/risk-control', $riskView);

// legacy urls -> unified ops center
Route::get('/' . $securePath . '/plan-i18n', function () use ($opsPath) {
    return redirect('/' . $opsPath . '/i18n');
});

Route::get('/' . $securePath . '/risk-control', function () use ($opsPath) {
    return redirect('/' . $opsPath . '/risk-control');
});

Route::get('/' . $securePath . '/admin-extension', function () use ($opsPath) {
    return redirect('/' . $opsPath);
});

if (!empty(config('v2board.subscribe_path'))) {
    Route::get(config('v2board.subscribe_path'), 'V1\\Client\\ClientController@subscribe')->middleware('client');
}
