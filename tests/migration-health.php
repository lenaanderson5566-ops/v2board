<?php
require __DIR__.'/../app/Services/MigrationHealthService.php';
use App\Services\MigrationHealthService;
$files = [];
foreach (glob(__DIR__.'/../database/migrations/*.php') as $file) $files[basename($file, '.php')] = $file;
$modern = array_values(array_filter(array_keys($files), fn($name) => str_starts_with($name, '2026_10')));
$assert = function ($condition, $message) { if (!$condition) throw new RuntimeException($message); };
$assert(count(array_diff(array_keys($files), $modern)) === 20, 'Expected legacy upgrade reproduction');
$assert(MigrationHealthService::pending($files, $modern, true) === [], 'Completed upgrade must be healthy');
$withoutBaseline = array_values(array_diff($modern, ['2026_10_11_000000_ensure_operations_schema']));
$assert(count(MigrationHealthService::pending($files, $withoutBaseline, true)) === 20, 'Missing baseline must stay pending');
$missing = '2026_10_11_000010_create_lightsail_servers';
$assert(MigrationHealthService::pending($files, array_diff($modern, [$missing]), true) === [$missing], 'Missing modern migration must stay pending');
$assert(MigrationHealthService::pending($files, $modern, false) === ['2019_08_19_000000_create_failed_jobs_table'], 'Missing failed jobs table must stay pending');
$files['2027_01_01_000001_future'] = 'future.php';
$assert(MigrationHealthService::pending($files, $modern, true) === ['2027_01_01_000001_future'], 'Future migrations must stay pending');
$assert(count(MigrationHealthService::pending($files, [], false)) === count($files), 'Uninitialized repository must stay pending');
echo "Migration health: 7 checks passed\n";
