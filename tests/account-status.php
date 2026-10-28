<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
$service = new App\Services\AccountStatusService();
$base = ['banned'=>0,'plan_id'=>1,'expired_at'=>time()+86400,'transfer_enable'=>100,'u'=>5,'d'=>10];
foreach ([
    [[], 'active', true, false],
    [['plan_id'=>null,'expired_at'=>0], 'new', false, false],
    [['expired_at'=>time()-1], 'expired', false, false],
    [['expired_at'=>time()], 'expired', false, false],
    [['expired_at'=>null], 'active', true, false],
    [['banned'=>1], 'banned', false, false],
    [['banned'=>1,'plan_id'=>null], 'banned', false, false],
    [['u'=>60,'d'=>40], 'active', true, true],
    [['transfer_enable'=>0], 'active', false, false],
] as [$fields,$state,$available,$exhausted]) {
    $result = $service->forUser(new App\Models\User(array_replace($base,$fields)));
    $assert($result['state']===$state, 'Classification failed');
    $assert($result['is_available']===$available && $result['quota_exhausted']===$exhausted, 'Availability failed');
}
Illuminate\Support\Facades\DB::beginTransaction();
$auth = null;
try {
    $password = bin2hex(random_bytes(16));
    $user = App\Models\User::create(['email'=>'account-status-'.bin2hex(random_bytes(5)).'@example.com','password'=>password_hash($password,PASSWORD_DEFAULT),'uuid'=>App\Utils\Helper::guid(true),'token'=>App\Utils\Helper::guid(),'banned'=>1,'transfer_enable'=>100,'u'=>20,'d'=>30]);
    $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
    $login = Illuminate\Http\Request::create('/api/v1/passport/auth/login','POST',['email'=>$user->email,'password'=>$password]);
    $login->headers->set('Accept','application/json');
    $response = $kernel->handle($login);
    $assert($response->getStatusCode()===500 && json_decode($response->getContent(),true)['code']==='ACCOUNT_BANNED', 'Banned login must remain denied with a machine-readable code');
    $auth = new App\Services\AuthService($user);
    $token = $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data'];
    $request = Illuminate\Http\Request::create('/api/v10/me');
    $request->headers->set('Accept','application/json');
    $request->headers->set('Authorization','Bearer '.$token);
    $response = $kernel->handle($request);
    $assert($response->getStatusCode()===403 && !isset(json_decode($response->getContent(),true)['data']), 'A suspended existing session must be denied by V10');
    $status=$service->forUser($user);
    $assert($status['state']==='banned' && !$status['is_available'], 'Suspension remains authoritative for an existing session');
    $assert($user->fresh()->u===20 && $user->fresh()->d===30, 'Rejected reads must preserve usage counters');
    echo "Account status: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
}
