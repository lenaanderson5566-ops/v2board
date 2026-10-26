<?php
// Scripts run in separate processes; transactional cases share a disposable schema.
require __DIR__.'/support/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function(Throwable $error) { fwrite(STDERR, get_class($error).': '.$error->getMessage().PHP_EOL); exit(1); });
$manifest = json_decode(file_get_contents(__DIR__.'/suites.json'), true, 512, JSON_THROW_ON_ERROR);
$manifest['tests'] = array_map(fn($entry) => $entry + ['type'=>'php', 'profile'=>'full'], $manifest['tests']);
$options = getopt('', ['list', 'validate', 'suite:', 'only:', 'results:']);
if (isset($options['validate'])) {
    $ids = [];
    foreach ($manifest['tests'] as $entry) {
        if (isset($ids[$entry['id']]) || !in_array($entry['suite'], ['unit','integration','api','security','regression'], true)) throw new RuntimeException('Duplicate or invalid suite: '.$entry['id']);
        $ids[$entry['id']] = true;
        if (!str_starts_with($entry['file'], 'tests/') || str_contains($entry['file'], '..') || !is_file(base_path($entry['file']))) throw new RuntimeException('Invalid test reference: '.$entry['file']);
    }
    foreach ($manifest['helpers'] as $file) if (!is_file(base_path($file))) throw new RuntimeException('Missing helper: '.$file);
    $registered = array_merge(array_column($manifest['tests'], 'file'), $manifest['helpers']);
    foreach (array_merge(glob(__DIR__.'/*.php'), glob(__DIR__.'/*.sh')) as $file) if (!in_array('tests/'.basename($file), $registered, true)) throw new RuntimeException('Unregistered script: '.$file);
    echo count($ids).' test entries and '.count($manifest['helpers']).' helper references validated'.PHP_EOL;
    exit(0);
}
$entries = array_filter($manifest['tests'], fn($entry) =>
    (!isset($options['suite']) || $entry['suite'] === $options['suite']) &&
    (!isset($options['only']) || in_array($entry['id'], explode(',', $options['only']), true)));
if (isset($options['list'])) {
    foreach ($entries as $entry) echo $entry['suite'].' '.$entry['id'].' → '.$entry['file'].PHP_EOL;
    exit(0);
}
if (!$entries) throw new RuntimeException('No matching tests');
if (!app()->environment(['local', 'testing']) || getenv('TEST_DISPOSABLE_WORKSPACE') !== '1') {
    throw new RuntimeException('Run in a disposable project copy with TEST_DISPOSABLE_WORKSPACE=1; scripts may modify configuration files');
}
foreach (['.env'=>"# Disposable test workspace\n", 'config/v2board.php'=>"<?php return [];\n"] as $path=>$fixture) {
    if (!is_file(base_path($path))) file_put_contents(base_path($path), $fixture);
}
$mysql = config('database.connections.mysql');
$admin = new PDO('mysql:host='.$mysql['host'].';port='.$mysql['port'].';charset=utf8mb4', $mysql['username'], $mysql['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$token = bin2hex(random_bytes(4));
$results = [];
$migrations = [];
$databases = [];
$autoloadPath = base_path('tests/support/autoload.php');
register_shutdown_function(function() use ($admin, &$databases) {
    foreach (array_keys($databases) as $database) $admin->exec('DROP DATABASE IF EXISTS `'.$database.'`');
});
$run = function(array $command, array $environment) {
    $process = proc_open($command, [0=>['pipe','r'], 1=>['pipe','w'], 2=>['redirect',1]], $pipes, base_path(), $environment);
    if (!is_resource($process)) throw new RuntimeException('Unable to start test');
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    return ['exitCode'=>proc_close($process), 'output'=>$output];
};
foreach ($entries as $entry) {
    $database = ($entry['profile'] === 'notification' ? 'notification_test_' : ($entry['profile'] === 'mail-install' ? 'notification_install_' : 'commerce_test_')).($entry['profile'] === 'full' ? $token : bin2hex(random_bytes(4)));
    $started = microtime(true);
    $cacheToken = $token.'_'.str_replace('-', '_', $entry['id']);
    $environment = array_merge(getenv(), [
        'DB_DATABASE'=>$database, 'COMMERCE_TEST_DATABASE'=>$database,
        'NOTIFICATION_TEST_DATABASE'=>$database, 'NOTIFICATION_INSTALL_DATABASE'=>$database,
        'CACHE_DRIVER'=>'redis', 'CACHE_PREFIX'=>'test_suite_'.$cacheToken,
        'REDIS_DB'=>'14', 'REDIS_CACHE_DB'=>'15', 'REDIS_PREFIX'=>'test_suite_'.$cacheToken.':',
        'QUEUE_CONNECTION'=>'sync', 'LOG_CHANNEL'=>'stderr', 'LOG_LEVEL'=>'error',
        'APP_CONFIG_CACHE'=>base_path('bootstrap/cache/test-'.$token.'.php'),
    ]);
    try {
        $initialize = !isset($databases[$database]);
        if ($initialize) {
            $admin->exec('CREATE DATABASE `'.$database.'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            $databases[$database] = true;
        }
        if ($initialize && $entry['profile'] === 'full') {
            config(['database.connections.suite'=>array_merge($mysql, ['database'=>$database]), 'database.default'=>'suite']);
            Illuminate\Support\Facades\DB::purge('suite');
            Illuminate\Support\Facades\DB::unprepared(file_get_contents(database_path('install.sql')));
            foreach (glob(database_path('migrations/2026_10*.php')) as $file) {
                if (!isset($migrations[$file])) {
                    $migration = require_once $file;
                    if (!is_object($migration)) {
                        preg_match('/class\s+(\w+)\s+extends\s+Migration/', file_get_contents($file), $match);
                        $migration = new ($match[1]);
                    }
                    $migrations[$file] = $migration;
                }
                $migrations[$file]->up();
            }
            Illuminate\Support\Facades\DB::table('v2_plan')->insert(['name'=>'Test fixture', 'group_id'=>1, 'transfer_enable'=>10, 'month_price'=>1000, 'show'=>1, 'renew'=>1, 'created_at'=>time(), 'updated_at'=>time()]);
        }
        if (in_array($entry['profile'], ['notification', 'mail-install'], true)) unset($environment['COMMERCE_TEST_DATABASE']);
        $command = $entry['type'] === 'shell' ? ['bash', $entry['file']] : [PHP_BINARY, '-d', 'auto_prepend_file='.$autoloadPath, 'tests/support/run-script.php', $entry['type'] === 'phpunit' ? 'vendor/bin/phpunit' : $entry['file']];
        $result = $run(array_merge($command, $entry['args'] ?? []), $environment);
    } catch (Throwable $error) {
        $result = ['exitCode'=>1, 'output'=>get_class($error).': '.$error->getMessage()];
    } finally {
        Illuminate\Support\Facades\DB::disconnect('suite');
        if ($entry['profile'] !== 'full') {
            $admin->exec('DROP DATABASE IF EXISTS `'.$database.'`');
            unset($databases[$database]);
        }
        foreach (glob(base_path('bootstrap/cache/test-'.$token.'.php')) as $cache) unlink($cache);
    }
    $result += ['id'=>$entry['id'], 'suite'=>$entry['suite'], 'file'=>$entry['file'], 'seconds'=>round(microtime(true)-$started, 2)];
    $results[] = $result;
    echo ($result['exitCode'] === 0 ? 'PASS ' : 'FAIL ').$entry['id'].' ('.$result['seconds'].'s)'.PHP_EOL;
    if ($result['exitCode'] !== 0) echo $result['output'].PHP_EOL;
    if (isset($options['results'])) file_put_contents($options['results'], json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
}
$failed = count(array_filter($results, fn($result) => $result['exitCode'] !== 0));
echo count($results).' scripts: '.(count($results)-$failed).' passed, '.$failed.' failed'.PHP_EOL;
exit($failed ? 1 : 0);
