<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$checks = 0;
$assert = function ($condition, $message) use (&$checks) { if (!$condition) throw new RuntimeException($message); $checks++; };
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
    $request = Illuminate\Http\Request::create('/api/v1/user/info');
    $request->headers->set('Accept','application/json');
    $request->headers->set('Authorization',$token);
    $response = $kernel->handle($request);
    $data = json_decode($response->getContent(),true)['data'];
    $assert($response->getStatusCode()===200 && $data['account_status']['state']==='banned', 'Existing session must receive current suspension state');
    $assert($data['u']==20 && $data['d']==30, 'Account usage counters must be exposed accurately');
    echo "Account status: {$checks} checks passed\n";
} finally {
    if ($auth) $auth->removeAllSession();
    Illuminate\Support\Facades\DB::rollBack();
}
