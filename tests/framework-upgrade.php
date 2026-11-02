<?php
// Local only; real framework transports are exercised without network delivery.
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function ($error) { fwrite(STDERR, $error->getMessage()."\n"); exit(1); });
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$assert(app('config') instanceof App\Support\SiteConfigurationRepository, 'Site settings aliases must be installed before application providers');
$settings = new App\Support\SiteConfigurationRepository([
    'fastai'=>['name'=>'current', 'disabled'=>false, 'zero'=>0, 'empty'=>[], 'nullable'=>null],
    'v2board'=>['name'=>'legacy', 'retired'=>'must-not-return'],
    'other'=>['name'=>'unrelated'],
]);
$assert($settings->get('fastai.name') === 'current' && $settings->get('v2board.name') === 'current'
    && !$settings->has('fastai.retired'), 'Canonical settings must replace the complete legacy tree without reviving removed keys');
foreach (['disabled'=>false, 'zero'=>0, 'empty'=>[], 'nullable'=>null] as $key=>$value) {
    $assert($settings->has('fastai.'.$key) && $settings->has('v2board.'.$key)
        && $settings->get('fastai.'.$key, 'missing') === $value && $settings->get('v2board.'.$key, 'missing') === $value,
        'Explicit false-like setting must survive either namespace: '.$key);
}
$settings->set('v2board.name', 'updated');
$settings->set(['fastai.zero'=>2, 'v2board.disabled'=>true]);
$assert($settings->get('fastai.name') === 'updated' && $settings->get('v2board.zero') === 2
    && $settings->get('fastai.disabled') === true, 'Settings aliases must share writes immediately');
$assert($settings->getMany(['fastai.name', 'v2board.name', 'v2board.missing'=>'fallback'])
    === ['fastai.name'=>'updated', 'v2board.name'=>'updated', 'v2board.missing'=>'fallback'], 'Alias getMany must preserve requested keys and defaults');
$settings['v2board.array_access'] = 'shared';
$assert($settings['fastai.array_access'] === 'shared' && isset($settings['v2board.array_access']), 'ArrayAccess must use the same settings tree');
unset($settings['v2board.array_access']);
$assert(!$settings->has('fastai.array_access') && !$settings->has('v2board.array_access'), 'Removing a legacy alias must remove the canonical setting');
$assert(!array_key_exists('v2board', $settings->all()) && $settings->get('other.name') === 'unrelated', 'Configuration cache must export only canonical settings without changing unrelated namespaces');
$legacySettings = new App\Support\SiteConfigurationRepository(['v2board'=>['name'=>'legacy-cache']]);
$assert($legacySettings->get('fastai.name') === 'legacy-cache' && $legacySettings->get('v2board.name') === 'legacy-cache', 'An existing legacy-only config cache must remain readable');
$emptySettings = new App\Support\SiteConfigurationRepository(['fastai'=>[], 'v2board'=>['retired'=>true]]);
$assert($emptySettings->get('fastai') === [] && $emptySettings->get('v2board') === [], 'An explicitly empty canonical settings tree must override legacy values');

// This module runs only in a disposable workspace; use a private config directory too.
$configurationDirectory = sys_get_temp_dir().'/fastai-config-'.bin2hex(random_bytes(8));
mkdir($configurationDirectory, 0700);
$originalConfigurationDirectory = $app->configPath();
try {
    $app->useConfigPath($configurationDirectory);
    $currentPath = $configurationDirectory.'/fastai.php';
    $legacyPath = $configurationDirectory.'/v2board.php';
    $assert(App\Support\SiteConfiguration::path() === $currentPath && App\Support\SiteConfiguration::read() === null, 'Missing settings must not invent values or a legacy save target');
    $legacyFixture = '<?php return '.var_export(['app_name'=>'Legacy custom site', 'retired'=>'legacy-only'], true).';';
    file_put_contents($legacyPath, $legacyFixture);
    $assert(App\Support\SiteConfiguration::readPath() === $legacyPath
        && App\Support\SiteConfiguration::read()['app_name'] === 'Legacy custom site'
        && App\Support\SiteConfiguration::path() === $currentPath, 'Legacy files must be readable while new saves target the canonical file');
    file_put_contents($currentPath, '<?php return [];');
    $assert(App\Support\SiteConfiguration::readPath() === $currentPath && App\Support\SiteConfiguration::read() === [], 'An existing empty canonical file must not merge legacy settings');
    file_put_contents($currentPath, '<?php return '.var_export(['app_name'=>'Current custom site', 'disabled'=>false, 'zero'=>0, 'nullable'=>null], true).';');
    $currentSettings = App\Support\SiteConfiguration::read();
    $assert($currentSettings === ['app_name'=>'Current custom site', 'disabled'=>false, 'zero'=>0, 'nullable'=>null]
        && file_get_contents($legacyPath) === $legacyFixture, 'Canonical reads must retain explicit values without modifying the legacy file');
} finally {
    $app->useConfigPath($originalConfigurationDirectory);
    foreach (['fastai.php', 'v2board.php'] as $filename) if (is_file($configurationDirectory.'/'.$filename)) unlink($configurationDirectory.'/'.$filename);
    rmdir($configurationDirectory);
}
$manifest = json_decode(file_get_contents(base_path('composer.json')), true, 512, JSON_THROW_ON_ERROR);
$lock = json_decode(file_get_contents(base_path('composer.lock')), true, 512, JSON_THROW_ON_ERROR);
$lockedProduction = array_column($lock['packages'], null, 'name');
$lockedDevelopment = array_column($lock['packages-dev'], null, 'name');
$assert(str_starts_with($app->version(), '13.') && version_compare($app->version(), '13.39.0', '>='), 'Unexpected framework version');
$assert(!isset($manifest['require']['linfo/linfo']) && !isset($manifest['require-dev']['linfo/linfo'])
    && !isset($lockedProduction['linfo/linfo']) && !isset($lockedDevelopment['linfo/linfo'])
    && !Composer\InstalledVersions::isInstalled('linfo/linfo') && !class_exists('Linfo\\Linfo'), 'Removed system-info dependency remains installed or autoloadable');
$assert(!isset($manifest['require']['laravel/tinker']) && isset($manifest['require-dev']['laravel/tinker'])
    && !isset($lockedProduction['laravel/tinker']) && isset($lockedDevelopment['laravel/tinker'])
    && !Composer\InstalledVersions::isInstalled('laravel/tinker', false), 'Tinker must remain a development-only dependency');
$auditIgnore = (array)($manifest['config']['audit']['ignore'] ?? []);
$assert(!array_key_exists('PKSA-y2cr-5h3j-g3ys', $auditIgnore) && !in_array('PKSA-y2cr-5h3j-g3ys', $auditIgnore, true), 'Obsolete Composer audit exception remains configured');
$withDevelopment = Composer\InstalledVersions::getRootPackage()['dev'];
foreach (array_merge(array_keys($manifest['require']), $withDevelopment ? array_keys($manifest['require-dev']) : []) as $package) {
    if (!str_contains($package, '/')) continue; // PHP and extension platform requirements are checked by Composer.
    $locked = $lockedProduction[$package] ?? $lockedDevelopment[$package] ?? null;
    $assert($locked && Composer\InstalledVersions::isInstalled($package)
        && ltrim((string)Composer\InstalledVersions::getPrettyVersion($package), 'v') === ltrim($locked['version'], 'v'), 'Installed dependency differs from the tested lock: '.$package);
}
$assert($app->version() === ltrim(Composer\InstalledVersions::getPrettyVersion('laravel/framework'), 'v'), 'Loaded framework differs from the installed package');
$packageProviders = app(Illuminate\Foundation\PackageManifest::class)->providers();
foreach ([Laravel\Horizon\HorizonServiceProvider::class, Carbon\Laravel\ServiceProvider::class] as $provider) {
    $assert(in_array($provider, $packageProviders, true) && $app->getProvider($provider), 'Required package autodiscovery is missing: '.$provider);
}
// Use the isolated database/Redis and real Horizon bindings in both vendor profiles.
// No worker or scheduler is expected to be running in this disposable environment.
$masters = app(Laravel\Horizon\Contracts\MasterSupervisorRepository::class)->all();
$assert(is_iterable($masters), 'Horizon supervisor repository cannot read the isolated Redis connection');
$health = (new App\Services\SystemHealthService())->inspect();
$healthChecks = array_column($health['checks'], null, 'key');
$assert($health['frameworkVersion'] === $app->version() && $health['phpVersion'] === PHP_VERSION, 'Health report does not expose the actual runtime versions');
foreach (['database', 'redis', 'cache'] as $key) {
    $assert(($healthChecks[$key]['status'] ?? null) === 'healthy', 'Real dependency health probe failed: '.$key);
}
$assert(in_array($healthChecks['queue']['status'] ?? null, ['healthy', 'error'], true), 'Horizon health probe did not report a supported worker state');
foreach (["a@example.com\r\nBcc:b@example.com", "a@example.com\n", "a@example.com\0", 'a @example.com'] as $email) {
    $assert(validator(['email'=>$email], ['email'=>'email'])->fails(), 'Unsafe email accepted');
}
$assert(!validator(['email'=>'valid+tag@example.com'], ['email'=>'email'])->fails(), 'Valid email rejected');
$request = Illuminate\Http\Request::create('http://panel.example/', 'GET', [], [], [], ['REMOTE_ADDR'=>'192.0.2.5']);
$request->headers->set('X-Forwarded-For', '198.51.100.10');
$request->headers->set('X-Forwarded-Proto', 'https');
$middleware = new App\Http\Middleware\TrustProxies;
$middleware->handle($request, function ($request) use ($assert) {
    $assert($request->ip() === '192.0.2.5' && !$request->isSecure(), 'Untrusted proxy headers accepted');
    return response('ok');
});
$middleware = new class extends App\Http\Middleware\TrustProxies { protected $proxies = ['192.0.2.5']; };
$middleware->handle($request, function ($request) use ($assert) {
    $assert($request->ip() === '198.51.100.10' && $request->isSecure(), 'Trusted proxy headers ignored');
    return response('ok');
});
Symfony\Component\HttpFoundation\Request::setTrustedProxies([], 0);
foreach ([['smtp',587,'tls'], ['smtps',465,'ssl'], ['smtp',25,null]] as [$scheme, $port, $encryption]) {
    config(['mail.driver'=>'smtp', 'mail.scheme'=>$scheme, 'mail.host'=>'smtp.example.test', 'mail.port'=>$port,
        'mail.encryption'=>$encryption, 'mail.username'=>'test-user', 'mail.password'=>'test-password', 'mail.timeout'=>15]);
    Illuminate\Support\Facades\Mail::forgetMailers();
    $transport = Illuminate\Support\Facades\Mail::mailer()->getSymfonyTransport();
    $assert($transport instanceof Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport, 'SMTP transport not created');
    $assert($transport->getStream()->getTimeout() === 15.0, 'SMTP timeout ignored');
    $assert($transport->getUsername() === 'test-user', 'SMTP credentials ignored');
}
config(['mail.driver'=>'array', 'mail.from.address'=>'sender@example.test']);
Illuminate\Support\Facades\Mail::forgetMailers();
$sent = Illuminate\Support\Facades\Mail::raw('framework upgrade test', function ($message) {
    $message->to('recipient@example.test')->subject('Local transport test');
});
$assert($sent instanceof Illuminate\Mail\SentMessage, 'Symfony mail send contract broken');
$disk = Illuminate\Support\Facades\Storage::disk('local');
$path = 'framework-tests/'.bin2hex(random_bytes(8)).'.txt';
try {
    $assert($disk->put($path, 'roundtrip') && $disk->get($path) === 'roundtrip', 'Flysystem write/read failed');
} finally { $disk->delete($path); }
$legacy = app(App\Http\Controllers\V1\Server\UniProxyController::class);
$configController = app(App\Http\Controllers\V2\Server\ServerController::class);
$assert($legacy instanceof App\Http\Controllers\Controller && $configController instanceof App\Http\Controllers\Controller, 'Route tooling can resolve controllers without node credentials');
foreach(['user','push','alive','alivelist'] as $method){try{$legacy->$method(Request::create('/','GET',['node_id'=>1,'node_type'=>'v2box']));throw new RuntimeException('Legacy authentication bypass');}catch(Symfony\Component\HttpKernel\Exception\HttpException $e){$assert($e->getStatusCode()===401,'Legacy authentication still runs before each action');}}
$invalid=$configController->config(Request::create('/','GET',['node_id'=>1,'node_type'=>'v2box']));$assert($invalid->getStatusCode()===200 && $invalid->getData(true)['message']==='token is null','V2 failure response contract preserved without process exit');
// Resolve registration without running scheduled business commands.
$commands = app(Illuminate\Contracts\Console\Kernel::class)->all();
$tinkerProvider = 'Laravel\\Tinker\\TinkerServiceProvider';
$assert($withDevelopment
    ? (Composer\InstalledVersions::isInstalled('laravel/tinker') && in_array($tinkerProvider, $packageProviders, true) && isset($commands['tinker']))
    : (!Composer\InstalledVersions::isInstalled('laravel/tinker') && !class_exists($tinkerProvider) && !in_array($tinkerProvider, $packageProviders, true) && !isset($commands['tinker'])),
    'Tinker autodiscovery or command registration does not match the installed dependency profile');
$assert(!isset($commands['test']) || !$commands['test'] instanceof App\Console\Commands\Test, 'Empty application test command still shadows the framework command');
foreach (['fastai:install', 'fastai:update', 'fastai:statistics', 'v2board:install', 'v2board:update', 'v2board:statistics', 'reset:password', 'reset:user', 'clear:user', 'check:server', 'telegram:notify'] as $name) {
    $assert(isset($commands[$name]), 'Installation or manual operations command missing: '.$name);
}
foreach (['install', 'update', 'statistics'] as $operation) {
    $assert($commands['fastai:'.$operation] === $commands['v2board:'.$operation], 'A legacy command alias must resolve the canonical implementation: '.$operation);
}
foreach (App\Console\Commands\RunDailyTask::TASKS as $name => $at) {
    $assert(isset($commands[$name]), 'Daily task is not registered: '.$name);
}
$schedule = app(Illuminate\Console\Scheduling\Schedule::class);
foreach ($schedule->events() as $event) {
    if (!$event->command) continue; // The scheduler heartbeat is a closure.
    $assert((bool) preg_match('/artisan[\x27\x22]?\s+([\w:-]+)/', $event->command, $match), 'Cannot identify scheduled Artisan command');
    $assert(isset($commands[$match[1]]), 'Scheduled command is not registered: '.$match[1]);
}
// Upgrades must still deserialize and safely consume retired notification jobs.
$sentRequests = 0;
Illuminate\Support\Facades\Http::fake(function () use (&$sentRequests) { $sentRequests++; throw new RuntimeException('Retired notification attempted HTTP delivery'); });
$legacyJob = unserialize(serialize(new App\Jobs\SendTelegramJob(123, 'retired queue fixture')));
$assert($legacyJob instanceof Illuminate\Contracts\Queue\ShouldQueue && $legacyJob->queue === 'send_telegram', 'Legacy notification queue compatibility lost');
$legacyJob->handle();
$assert($commands['telegram:notify']->run(new Symfony\Component\Console\Input\ArrayInput([]), new Symfony\Component\Console\Output\BufferedOutput) === 0, 'External legacy cron compatibility lost');
$assert($sentRequests === 0, 'Retired notification sent a message');

// Queue limits must load without warnings or response output.
$original = Illuminate\Support\Env::get('HORIZON_MAX_PROCESSES');
$repository = Illuminate\Support\Env::getRepository();
set_error_handler(function ($severity, $message, $file, $line) { throw new ErrorException($message, 0, $severity, $file, $line); });
try {
    foreach ([null => 6, '12' => 12, '0' => 1, '-2' => 1, 'invalid' => 1] as $input => $expected) {
        if ($input === '') $repository->clear('HORIZON_MAX_PROCESSES');
        else $repository->set('HORIZON_MAX_PROCESSES', $input);
        ob_start();
        try { $config = require __DIR__ . '/../config/horizon.php'; }
        finally { $output = ob_get_clean(); }
        $assert($output === '', 'Configuration emitted response output');
        $assert($config['environments']['*']['FastAI']['maxProcesses'] === $expected, 'Incorrect queue worker limit');
        $assert($config['environments']['*']['FastAI']['queue'] === ['order_handle', 'traffic_fetch', 'stat', 'send_email', 'send_telegram'], 'Renaming the supervisor must not orphan existing queued jobs');
    }
} finally {
    try {
        if ($original === null) $repository->clear('HORIZON_MAX_PROCESSES');
        else $repository->set('HORIZON_MAX_PROCESSES', $original);
    } finally { restore_error_handler(); }
}

// Preserve upgrade-baseline and pending-migration detection.
$queueConfig = require __DIR__.'/../config/queue.php';
$workers = (require __DIR__.'/../config/horizon.php')['environments']['*'];
foreach (['FastAI'=>new App\Jobs\ProcessNodeTrafficBatch(1), 'mail-bulk'=>new App\Jobs\SendCampaignMailJob(1)] as $name=>$job) {
    $worker = $workers[$name];
    $assert($job->timeout < $worker['timeout'] && $worker['timeout'] < $queueConfig['connections'][$worker['connection']]['retry_after'], 'Job, supervisor and reservation timeouts must leave termination margins: '.$name);
}
foreach (['database','beanstalkd','redis'] as $connection) {
    $assert($queueConfig['connections'][$connection]['retry_after'] > (new App\Jobs\ProcessNodeTrafficBatch(1))->timeout, 'Slow traffic batch cannot be reclaimed while executing: '.$connection);
}

$files = [];
foreach (glob(__DIR__.'/../database/migrations/*.php') as $file) $files[basename($file, '.php')] = $file;
$modern = array_values(array_filter(array_keys($files), fn($name) => str_starts_with($name, '2026_10')));
$assert(count(array_diff(array_keys($files), $modern)) === 20, 'Expected legacy upgrade reproduction');
$assert(App\Services\MigrationHealthService::pending($files, $modern, true) === [], 'Completed upgrade must be healthy');
$withoutBaseline = array_values(array_diff($modern, ['2026_10_11_000000_ensure_operations_schema']));
$assert(count(App\Services\MigrationHealthService::pending($files, $withoutBaseline, true)) === 20, 'Missing baseline must stay pending');
$missing = '2026_10_11_000010_create_lightsail_servers';
$assert(App\Services\MigrationHealthService::pending($files, array_diff($modern, [$missing]), true) === [$missing], 'Missing modern migration must stay pending');
$assert(App\Services\MigrationHealthService::pending($files, $modern, false) === ['2019_08_19_000000_create_failed_jobs_table'], 'Missing failed jobs table must stay pending');
$files['2027_01_01_000001_future'] = 'future.php';
$assert(App\Services\MigrationHealthService::pending($files, $modern, true) === ['2027_01_01_000001_future'], 'Future migrations must stay pending');
$assert(count(App\Services\MigrationHealthService::pending($files, [], false)) === count($files), 'Uninitialized repository must stay pending');

echo "Laravel 13: $checks checks passed; no real mail sent.\n";
