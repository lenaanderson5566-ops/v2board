<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;

$originalConfig = config('v2board');
$originalPublic = public_path();
$originalRoutes = Route::getRoutes();
$temporary = sys_get_temp_dir() . '/console-verify-' . bin2hex(random_bytes(8));
$checks = 0;
$assert = function ($condition, $message) use (&$checks) {
    if (!$condition) throw new RuntimeException($message . ': ' . Artisan::output());
    $checks++;
};
try {
    config(['v2board.safe_mode_enable' => 1, 'v2board.app_url' => 'https://console.example.com']);
    $assert(Artisan::call('console:verify', ['--host' => 'console.example.com']) === 0, 'Valid deployment rejected');
    $assert(Artisan::call('console:verify', ['--host' => 'wrong.example.com']) === 1 && strpos(Artisan::output(), '403') !== false, 'Domain mismatch not detected');

    $routes = new Illuminate\Routing\RouteCollection();
    $routes->add(new Illuminate\Routing\Route(['GET'], '/', function () { return '<html>Old admin</html>'; }));
    Route::setRoutes($routes);
    $assert(Artisan::call('console:verify', ['--host' => 'console.example.com']) === 1 && strpos(Artisan::output(), 'Old or incorrect page') !== false, 'Old page not detected');
    Route::setRoutes($originalRoutes);

    mkdir($temporary . '/console/.vite', 0700, true);
    file_put_contents($temporary . '/console/.vite/manifest.json', json_encode(['src/main.tsx' => ['file' => 'missing.js']]));
    $app->instance('path.public', $temporary);
    $assert(Artisan::call('console:verify') === 1 && strpos(Artisan::output(), 'Missing or invalid console asset') !== false, 'Missing asset not detected');
} finally {
    config(['v2board' => $originalConfig]);
    $app->instance('path.public', $originalPublic);
    Route::setRoutes($originalRoutes);
    if (is_file($temporary . '/console/.vite/manifest.json')) unlink($temporary . '/console/.vite/manifest.json');
    if (is_dir($temporary . '/console/.vite')) rmdir($temporary . '/console/.vite');
    if (is_dir($temporary . '/console')) rmdir($temporary . '/console');
    if (is_dir($temporary)) rmdir($temporary);
}
echo "Console deployment: {$checks} checks passed\n";
