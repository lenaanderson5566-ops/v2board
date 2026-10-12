<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\UserConnectionLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\Request;
$n = 0;
$assert = function ($ok, $label) use (&$n) { if (!$ok) throw new RuntimeException($label); $n++; };
DB::beginTransaction();
try {
    $prefix = 'connection-'.bin2hex(random_bytes(6));
    $users = [];
    foreach (['one','two','deleted'] as $name) {
        $user = User::create(['email'=>"$prefix-$name@example.com",'password'=>'unused','uuid'=>(string) Illuminate\Support\Str::uuid(),'token'=>Illuminate\Support\Str::random(32)]);
        $users[$name] = $user;
        UserConnectionLog::create(['user_id'=>$user->id,'ip'=>'192.0.2.123','node'=>'test','connected_at'=>time()]);
    }
    $users['deleted']->delete();
    UserConnectionLog::create(['user_id'=>$users['one']->id,'ip'=>'192.0.2.123','node'=>'test','connected_at'=>time()-366*86400]);
    $fetch = function ($params) {
        $response = (new App\Http\Controllers\V1\Risk\LogController())->getUserConnectionLogs(Request::create('/', 'GET', $params));
        return json_decode($response->getContent(), true);
    };
    $result = $fetch(['email'=>$prefix,'page_size'=>1]);
    $assert($result['total'] === 2 && count($result['data']) === 1, 'Email filtering applies before pagination and excludes old logs');
    $assert(str_starts_with($result['data'][0]['email'], $prefix), 'Email is included in connection rows');
    $result = $fetch(['email'=>$users['one']->email,'user_id'=>$users['one']->id]);
    $assert($result['total'] === 1 && $result['data'][0]['email'] === $users['one']->email, 'Email and user ID filters combine');
    $assert($fetch(['email'=>$users['one']->email,'user_id'=>$users['two']->id])['total'] === 0, 'Mismatched user filters return no rows');
    $assert($fetch(['email'=>$prefix,'ip'=>'192.0.2.124'])['total'] === 0, 'Email and IP filters combine');
    $result = $fetch(['user_id'=>$users['deleted']->id]);
    $assert($result['total'] === 1 && $result['data'][0]['email'] === null, 'Deleted users retain history without fabricated email');
    $users['one']->update(['email'=>"$prefix-renamed@example.com"]);
    $result = $fetch(['email'=>"$prefix-renamed"]);
    $assert($result['total'] === 1 && $result['data'][0]['email'] === "$prefix-renamed@example.com", 'Existing logs resolve current email after rename');
    $assert(!array_key_exists('token', $result['data'][0]) && !array_key_exists('password', $result['data'][0]), 'No user credentials included');
    echo "Connection log email: {$n} checks passed\n";
} finally { DB::rollBack(); }