<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$id = (int)($argv[2] ?? random_int(1000000000, 2000000000));
$user = new App\Models\User();
$user->id = $id;
$auth = new App\Services\AuthService($user);
$issue = fn() => $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
if (($argv[1] ?? '') === 'worker') {
    $operation = $argv[3];
    if ($operation === 'recover') {
        $gate=$argv[6]; $slot=(int)$argv[7];
        Illuminate\Support\Facades\Cache::put($gate.':ready:'.$slot,true,30);
        $deadline=microtime(true)+10;
        while (!Illuminate\Support\Facades\Cache::get($gate.':release')) {
            if (microtime(true)>$deadline) throw new RuntimeException('Recovery worker start gate timed out');
            usleep(10000);
        }
        $request=Illuminate\Http\Request::create('/api/v10/auth/password-resets','POST');
        app()->instance('request',$request);
        try {
            $account=App\Models\User::findOrFail($id);
            (new App\Services\PasswordRecovery())->recover($account->email,$argv[4],$argv[5]);
            echo json_encode(['outcome'=>'reset','slot'=>$slot]);
        } catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
            if ($error->getStatusCode()!==409) throw $error;
            echo json_encode(['outcome'=>'rejected','slot'=>$slot]);
        }
    }
    elseif ($operation === 'add') $issue();
    elseif ($operation === 'remove') $auth->removeSession($argv[4]);
    else $auth->removeAllSession();
    exit(0);
}
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$run = function (array $operations, ?int $workerId=null, ?callable $release=null) use ($id) {
    $children = [];
    foreach ($operations as $args) {
        $process = proc_open(array_merge([PHP_BINARY, __FILE__, 'worker', (string)($workerId ?? $id)], $args), [1=>['pipe','w'],2=>['pipe','w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('Worker failed to start');
        $children[] = [$process,$pipes];
    }
    if ($release) $release();
    $results=[];
    foreach ($children as [$process,$pipes]) {
        $output = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
        foreach ($pipes as $pipe) fclose($pipe);
        if (proc_close($process) !== 0) throw new RuntimeException('Worker failed: '.$output);
        $results[]=trim($output);
    }
    return $results;
};
$recoveryAccount=null; $recoveryKeys=[];
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
    // One code must authorize only one reset, including overlapping consumers.
    if (!getenv('COMMERCE_TEST_DATABASE')) throw new RuntimeException('Recovery concurrency requires an isolated test database');
    $recoveryAccount=App\Models\User::create(['email'=>'recovery-race-'.bin2hex(random_bytes(6)).'@example.com','password'=>password_hash('RecoveryRaceOriginal!2026',PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid()]);
    $recoveryAuth=new App\Services\AuthService($recoveryAccount);
    $oldTokens=[];
    for ($index=0;$index<2;$index++) $oldTokens[]=$recoveryAuth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $recoveryQueue=Illuminate\Support\Facades\Queue::getFacadeRoot();
    Illuminate\Support\Facades\Queue::fake();
    try {
        (new App\Services\PasswordRecovery())->send($recoveryAccount->email);
        $job=Illuminate\Support\Facades\Queue::pushed(App\Jobs\SendEmailJob::class)->last();
        $mail=(new ReflectionProperty($job,'params'))->getValue($job);
    } finally { Illuminate\Support\Facades\Queue::swap($recoveryQueue); }
    $challengeKey=App\Services\PasswordRecovery::challengeKey((int)$recoveryAccount->id);
    $gate=$challengeKey.':race:'.bin2hex(random_bytes(6));
    $recoveryKeys=[$challengeKey,$challengeKey.':sent',$challengeKey.':attempts',$gate.':release',$gate.':ready:0',$gate.':ready:1'];
    $passwords=['RecoveryRaceFirst!2026','RecoveryRaceSecond!2026'];
    Illuminate\Support\Facades\DB::beginTransaction();
    App\Models\User::whereKey($recoveryAccount->id)->lockForUpdate()->firstOrFail();
    try {
        $results=$run([
            ['recover',$mail['template_value']['code'],$passwords[0],$gate,'0'],
            ['recover',$mail['template_value']['code'],$passwords[1],$gate,'1'],
        ],(int)$recoveryAccount->id,function() use($gate) {
            $deadline=microtime(true)+10;
            while (!Illuminate\Support\Facades\Cache::get($gate.':ready:0') || !Illuminate\Support\Facades\Cache::get($gate.':ready:1')) {
                if (microtime(true)>$deadline) throw new RuntimeException('Recovery workers did not reach the start gate');
                usleep(10000);
            }
            Illuminate\Support\Facades\Cache::put($gate.':release',true,30);
            Illuminate\Support\Facades\DB::commit();
        });
    } finally {
        while (Illuminate\Support\Facades\DB::transactionLevel()) Illuminate\Support\Facades\DB::rollBack();
    }
    $results=array_map(fn($output)=>json_decode($output,true,512,JSON_THROW_ON_ERROR),$results);
    $winners=array_values(array_filter($results,fn($result)=>$result['outcome']==='reset'));
    $assert(count($winners)===1 && count(array_filter($results,fn($result)=>$result['outcome']==='rejected'))===1,'A recovery code was consumed more than once by concurrent workers');
    $recoveryAccount->refresh();
    $winner=$winners[0]['slot'];
    $assert(password_verify($passwords[$winner],$recoveryAccount->password) && !password_verify($passwords[1-$winner],$recoveryAccount->password),'The losing recovery worker overwrote the winning password');
    $assert(!$recoveryAuth->getSessions(),'Concurrent recovery did not revoke every login session');
    foreach ($oldTokens as $oldToken) $assert(App\Services\AuthService::decryptAuthData($oldToken)===false,'A pre-recovery session survived concurrent reset');
    $assert(!Illuminate\Support\Facades\Cache::has($challengeKey),'Concurrent recovery left a reusable challenge');
    echo "Session concurrency: $checks checks passed\n";
} finally {
    $auth->removeAllSession();
    foreach ($recoveryKeys as $key) Illuminate\Support\Facades\Cache::forget($key);
    if ($recoveryAccount) {
        (new App\Services\AuthService($recoveryAccount))->removeAllSession();
        $recoveryAccount->delete();
    }
}
