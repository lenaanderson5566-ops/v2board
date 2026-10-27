<?php
// Local only; real framework transports are exercised without network delivery.
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
set_exception_handler(function ($error) { fwrite(STDERR, $error->getMessage()."\n"); exit(1); });
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$assert(str_starts_with($app->version(), '13.'), 'Unexpected framework version');
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
$assert(!isset($commands['test']) || !$commands['test'] instanceof App\Console\Commands\Test, 'Empty application test command still shadows the framework command');
foreach (['v2board:install', 'v2board:update', 'reset:password', 'reset:user', 'clear:user', 'check:server', 'telegram:notify'] as $name) {
    $assert(isset($commands[$name]), 'Installation or manual operations command missing: '.$name);
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
        $assert($config['environments']['*']['V2board']['maxProcesses'] === $expected, 'Incorrect queue worker limit');
    }
} finally {
    try {
        if ($original === null) $repository->clear('HORIZON_MAX_PROCESSES');
        else $repository->set('HORIZON_MAX_PROCESSES', $original);
    } finally { restore_error_handler(); }
}

// Preserve upgrade-baseline and pending-migration detection.
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
