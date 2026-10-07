<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$id = (int)($argv[2] ?? random_int(1000000000, 2000000000));
$user = new App\Models\User();
$user->id = $id;
$auth = new App\Services\AuthService($user);
$issue = fn() => $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
if (($argv[1] ?? '') === 'worker') {
    $operation = $argv[3];
    if ($operation === 'add') $issue();
    elseif ($operation === 'remove') $auth->removeSession($argv[4]);
    else $auth->removeAllSession();
    exit(0);
}
$checks = 0;
$assert = function ($ok, $message) use (&$checks) {if (!$ok) throw new RuntimeException($message); $checks++;};
$run = function (array $operations) use ($id) {
    $children = [];
    foreach ($operations as $args) {
        $process = proc_open(array_merge([PHP_BINARY, __FILE__, 'worker', (string)$id], $args), [1=>['pipe','w'],2=>['pipe','w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('Worker failed to start');
        $children[] = [$process,$pipes];
    }
    foreach ($children as [$process,$pipes]) {
        $output = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
        foreach ($pipes as $pipe) fclose($pipe);
        if (proc_close($process) !== 0) throw new RuntimeException('Worker failed: '.$output);
    }
};
try {
    $seed = $issue();
    $claims = (array)Firebase\JWT\JWT::decode($seed, new Firebase\JWT\Key(config('app.key'),'HS256'));
    $run(array_fill(0,12,['add']));
    $assert(count($auth->getSessions()) === 13, 'Concurrent registrations lost sessions');
    $run(array_merge(array_fill(0,8,['add']),array_fill(0,8,['remove',$claims['session']])));
    $sessions = $auth->getSessions();
    $assert(count($sessions) === 20, 'Single-session revocation lost other registrations');
    $assert(!isset($sessions[$claims['session']]), 'Revoked session resurrected');
    $oldIds = array_keys($sessions);
    $run(array_merge(array_fill(0,8,['add']),[['all']]));
    $assert(!array_intersect($oldIds,array_keys($auth->getSessions())), 'All-session revocation restored old sessions');
    $auth->removeAllSession();
    $assert(!$auth->getSessions(), 'Final revocation did not clear sessions');
    $token = $issue();
    $lock = Illuminate\Support\Facades\Cache::lock(App\Utils\CacheKey::get('USER_SESSIONS', $id).':lock', 15);
    $assert($lock->get(), 'Could not acquire contention fixture lock');
    try {
        $failed = false;
        try {$auth->removeCurrentSession($token);}
        catch (Illuminate\Contracts\Cache\LockTimeoutException $error) {$failed = true;}
        $assert($failed, 'Lock timeout was reported as successful logout');
    } finally {
        $lock->release();
    }
    echo "Session concurrency: $checks checks passed\n";
} finally {
    $auth->removeAllSession();
}
