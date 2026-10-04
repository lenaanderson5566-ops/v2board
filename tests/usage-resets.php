<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(function (Throwable $error) { fwrite(STDERR, $error->getMessage().PHP_EOL); exit(1); });
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Services\UsageResetService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
$checks = 0;
$assert = function ($ok, $message) use (&$checks) { if (!$ok) throw new RuntimeException($message); $checks++; };
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$callIndex = 0;
$call = function ($path, $body, $token = null) use ($kernel, &$callIndex) {
    $request = Illuminate\Http\Request::create($path, $body === null ? 'GET' : 'POST', $body ?? [], [], [], ['REMOTE_ADDR' => '192.0.2.'.(++$callIndex)]);
    $request->headers->set('Accept', 'application/json');
    if ($token) $request->headers->set('Authorization', (strpos($path, '/api/v10/') === 0 ? 'Bearer ' : '').$token);
    return $kernel->handle($request);
};
$auths = [];
DB::beginTransaction();
try {
    $plan = Plan::firstOrFail();
    $makeUser = function ($admin = false) use ($plan, &$auths) {
        $user = User::create(['email'=>'reset-'.Str::uuid().'@example.com', 'password'=>password_hash(Str::random(24), PASSWORD_DEFAULT),
            'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(), 'is_admin'=>$admin ? 1 : 0,
            'plan_id'=>$plan->id, 'group_id'=>$plan->group_id, 'expired_at'=>time()+86400*20, 'transfer_enable'=>1073741824, 'credit_balance'=>75, 'u'=>10, 'd'=>20]);
        $auth = new App\Services\AuthService($user); $auths[] = $auth;
        return [$user, $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']];
    };
    [$user, $token] = $makeUser(); [$admin, $adminToken] = $makeUser(true); [$other, $otherToken] = $makeUser();
    $service = new UsageResetService();
    $adminPath = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
    // The admin API prefix is independent of the frontend secret route.
    $adminPath = 'admin';
    foreach (app('router')->getRoutes() as $route) {
        if (strpos($route->uri(), '/user/usageReset') !== false && strpos($route->uri(), 'Preview') === false) {
            $adminPath = substr($route->uri(), strlen('api/v1/'), -strlen('/user/usageReset')); break;
        }
    }
    $endpoint = '/api/v1/'.$adminPath.'/user/usageReset';
    $grant = ['kind'=>'grant', 'request_key'=>(string)Str::uuid(), 'expected_count'=>1, 'quantity'=>2,
        'filter'=>[['key'=>'id', 'condition'=>'=', 'value'=>$user->id]]];
    $assert($call('/api/v10/me/usage-resets', null)->getStatusCode()===401, 'Anonymous access accepted');
    $assert($call($endpoint, $grant, $token)->getStatusCode()===403, 'User could grant credits');
    $r = $call($endpoint, $grant, $adminToken);
    $assert($r->getStatusCode()===200, 'Grant failed: '.$r->getContent());
    $assert($service->summary($user->id)['available']===2, 'Grant count wrong');
    $assert($service->summary($other->id)['available']===0, 'Grant leaked to other user');
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===200 && $service->summary($user->id)['available']===2, 'Grant retry duplicated');
    $grant['quantity']=3;
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===422, 'Reused key allowed different payload');
    $grant['request_key']=(string)Str::uuid(); $grant['expected_count']=2;
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===422 && $service->summary($user->id)['available']===2, 'Count mismatch partially granted: '.json_encode($service->summary($user->id)));
    $before = $user->refresh()->only(['expired_at','transfer_enable','plan_id','token','uuid','balance','credit_balance']);
    $soonGrant = ['kind'=>'grant','request_key'=>(string)Str::uuid(),'expected_count'=>1,'quantity'=>1,'expires_at'=>time()+3600];
    $service->batch(User::where('id',$user->id),$admin->id,$soonGrant);
    $soon = DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->whereNotNull('expires_at')->first();
    $key=(string)Str::uuid();
    $r=$call('/api/v10/me/usage-resets/consumptions',['requestKey'=>$key,'user_id'=>$other->id],$token);
    $assert($r->getStatusCode()===200,'Consume failed: '.$r->getContent());
    $assert($user->refresh()->u===0 && $user->d===0,'Usage not cleared');
    $assert($user->only(array_keys($before))===$before,'Subscription or credentials changed');
    $assert($other->refresh()->u===10 && $other->d===20,'Other account was reset');
    $assert(DB::table('v2_usage_reset_credit')->where('id',$soon->id)->value('remaining')===0,'Expiring credit not used first');
    $user->update(['u'=>50]);
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>$key],$token)->getStatusCode()===200 && $user->refresh()->u===50,'Retry reset newly accrued usage');
    $assert($service->summary($user->id)['available']===2,'Retry consumed a second credit');
    foreach ([['banned'=>1], ['expired_at'=>time()-1], ['plan_id'=>null], ['transfer_enable'=>0]] as $state) {
        $original=$user->only(array_keys($state)); $user->update($state);
        $r=$call('/api/v10/me/usage-resets/consumptions',['requestKey'=>(string)Str::uuid()],$token);
        $assert($r->getStatusCode()===(isset($state['banned']) ? 403 : 422) && $service->summary($user->id)['available']===2,'Ineligible user consumed credit: '.$r->getContent());
        $user->update($original);
    }
    $user->update(['u'=>0,'d'=>0]);
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>(string)Str::uuid()],$token)->getStatusCode()===422,'Empty usage consumed credit');
    DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->update(['expires_at'=>time()-1]);
    $user->update(['u'=>100]);
    $assert($service->summary($user->id)['available']===0,'Expired credits counted');
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>(string)Str::uuid()],$token)->getStatusCode()===422,'Expired credits usable');
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>'bad'], $token)->getStatusCode()===422,'Invalid idempotency key accepted');
    $all=['kind'=>'global','request_key'=>(string)Str::uuid(),'expected_count'=>User::count(),'confirmation'=>'RESET ALL USAGE'];
    $wrong=$all; unset($wrong['confirmation']);
    $assert($call($endpoint,$wrong,$adminToken)->getStatusCode()===422,'Unconfirmed global reset accepted');
    $r=$call($endpoint,$all,$adminToken);
    $assert($r->getStatusCode()===200,'Global reset failed: '.$r->getContent());
    $assert($user->refresh()->u===0 && $other->refresh()->u===0,'Global reset did not affect all accounts');
    $assert(DB::table('v2_usage_reset_log')->where('user_id',$user->id)->where('kind','global')->value('u_before')===100,'Global audit lost prior usage');
    $other->update(['d'=>37]);
    $assert($call($endpoint,$all,$adminToken)->getStatusCode()===200 && $other->refresh()->d===37,'Repeated global reset changed new usage');
    $assert($user->only(array_keys($before))===$before,'Global reset changed plan or credentials');
    $logs=json_decode($call('/api/v10/me/usage-resets',null,$otherToken)->getContent(),true)['data']['history'];
    $assert(count($logs)===1 && $logs[0]['kind']==='global','History leaked another account records');
    $assert(App\Services\AuthService::decryptAuthData($token)!==false,'Reset revoked login');
    $redis = Illuminate\Support\Facades\Redis::getFacadeRoot();
    try {
        // Isolated buffered upload, no live Redis data is touched.
        Illuminate\Support\Facades\Redis::swap(new class($user->id) {
            private $id;
            public function __construct($id) {$this->id=$id;}
            public function exists($key) {return false;}
            public function hgetall($key) {return strpos($key,'upload')!==false ? [$this->id=>7] : [];}
            public function del($key) {return 1;}
        });
        (new App\Console\Commands\TrafficUpdate())->handle();
        $assert($user->refresh()->u===7 && $user->d===0,'Upload-only report was lost after reset');
        (new App\Console\Commands\TrafficUpdate())->handle();
        $assert($user->refresh()->u===14,'Traffic report did not increment stored usage');
    } finally { Illuminate\Support\Facades\Redis::swap($redis); }
    echo "Usage resets: $checks checks passed\n";
} finally {
    foreach ($auths as $auth) $auth->removeAllSession();
    DB::rollBack();
}
