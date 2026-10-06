<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($condition, $label) use (&$checks) { if (!$condition) throw new RuntimeException($label); $checks++; };
$original = config('v2board');
$directory = sys_get_temp_dir() . '/frontend-runtime-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
try {
    config(['v2board.secure_path' => 'test-admin', 'v2board.smtp_password' => 'must-not-be-exported']);
    $user = App\Support\FrontendRuntime::config('user', false);
    $admin = App\Support\FrontendRuntime::config('admin');
    $assert($user['adminPath'] === '' && $user['opsPath'] === '', 'User configuration hides administrative paths');
    $assert($admin['adminPath'] === 'test-admin', 'Admin path preserved');
    $assert($user['landing'] === false && !array_key_exists('landing', $admin), 'Server and standalone landing selection');
    $assert(!str_contains(json_encode($user), 'must-not-be-exported') && !str_contains(json_encode($admin), 'must-not-be-exported'), 'No backend secrets exported');
    $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => 'https://api.example.test', '--output' => $directory, '--mode' => 'user']) === 0, 'Public user export');
    $assert(is_file($directory . '/user-config.json') && !is_file($directory . '/admin-config.json'), 'User deployment excludes admin config');
    $exported = json_decode(file_get_contents($directory . '/user-config.json'), true);
    $assert($exported['apiBaseUrl'] === 'https://api.example.test' && $exported['mode'] === 'user', 'Backend origin and entry mode exported');
    $assert(!array_key_exists('landing', $exported), 'Standalone account path can select account page');
    foreach (['http://remote.example', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?token=x'] as $origin) {
        $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => $origin, '--output' => $directory]) === 1, 'Unsafe API origin rejected');
    }
    $assert(Illuminate\Support\Facades\Artisan::call('console:export-runtime', ['--api-origin' => 'https://api.example.test', '--output' => $directory, '--mode' => 'admin']) === 0, 'Public admin export');
    $assert(json_decode(file_get_contents($directory . '/admin-config.json'), true)['adminPath'] === 'test-admin', 'Admin export preserves API routing');
    echo "Frontend runtime: {$checks} checks passed\n";
} finally {
    config(['v2board' => $original]);
    foreach (['user-config.json', 'admin-config.json'] as $file) if (is_file($directory . '/' . $file)) unlink($directory . '/' . $file);
    rmdir($directory);
}
