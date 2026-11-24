<?php
$app = require __DIR__.'/support/bootstrap.php';
set_exception_handler(function (Throwable $error) { fwrite(STDERR, $error->getMessage().PHP_EOL); exit(1); });
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Models\Plan;
use App\Services\UsageResetService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
$checks = 0;
$assert = \Tests\Support\Assertions::counter($checks);
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
    $plan->update(['reset_traffic_method' => 0]);
    $makeUser = function ($admin = false) use ($plan, &$auths) {
        $user = User::create(['email'=>'reset-'.Str::uuid().'@example.com', 'password'=>password_hash(Str::random(24), PASSWORD_DEFAULT),
            'uuid'=>App\Utils\Helper::guid(true), 'token'=>App\Utils\Helper::guid(), 'is_admin'=>$admin ? 1 : 0,
            'plan_id'=>$plan->id, 'group_id'=>$plan->group_id, 'expired_at'=>time()+86400*100, 'transfer_enable'=>1073741824, 'credit_balance'=>75, 'u'=>10, 'd'=>20]);
        $auth = new App\Services\AuthService($user); $auths[] = $auth;
        return [$user, $auth->generateAuthData(Illuminate\Http\Request::create('/'))['auth_data']];
    };
    [$user, $token] = $makeUser(); [$admin, $adminToken] = $makeUser(true); [$other, $otherToken] = $makeUser();
    $service = new UsageResetService();
    $endpoint = '/api/v1/'.App\Http\Routes\V1\AdminRoute::prefix().'/user/usageReset';
    $creditsUrl = $endpoint.'Credits';
    $readCredits = function (int $userId) use ($call, $creditsUrl, $adminToken, $assert) {
        $response = $call($creditsUrl.'?user_id='.$userId, null, $adminToken);
        $assert($response->getStatusCode() === 200, 'Admin reset credit summary failed: '.$response->getContent());
        return json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR)['data'];
    };
    $logsUrl = fn (array $params) => $endpoint.'Logs?'.http_build_query($params);
    $readLogs = function (array $params) use ($call, $logsUrl, $adminToken, $assert) {
        $response = $call($logsUrl($params), null, $adminToken);
        $assert($response->getStatusCode() === 200, 'Admin usage reset history failed: '.$response->getContent());
        return json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
    };
    $grant = ['kind'=>'grant', 'request_key'=>(string)Str::uuid(), 'expected_count'=>1, 'quantity'=>2,
        'filter'=>[['key'=>'id', 'condition'=>'=', 'value'=>$user->id]]];
    $assert($call('/api/v10/me/usage-resets', null)->getStatusCode()===401, 'Anonymous access accepted');
    $assert($call($endpoint, $grant, $token)->getStatusCode()===403, 'User could grant credits');
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===422, 'Grant accepted without a confirmed user set');
    $preview = $call($endpoint.'Preview', ['filter'=>$grant['filter'], 'expected_count'=>1], $adminToken);
    $grant['scope_token'] = json_decode($preview->getContent(), true)['data']['scope_token'];
    $assert($preview->getStatusCode()===200 && is_string($grant['scope_token']), 'Grant preview failed');
    $user->update(['remarks'=>'scope-fixture']);
    $changedScope = array_replace($grant, ['request_key'=>(string)Str::uuid(), 'filter'=>[['key'=>'remarks','condition'=>'=','value'=>'scope-fixture']]]);
    $changedScope['scope_token'] = json_decode($call($endpoint.'Preview',
        ['filter'=>$changedScope['filter'], 'expected_count'=>1], $adminToken)->getContent(), true)['data']['scope_token'];
    $user->update(['remarks'=>null]);
    $other->update(['remarks'=>'scope-fixture']);
    $conflict = $call($endpoint, $changedScope, $adminToken);
    $assert($conflict->getStatusCode()===422 && json_decode($conflict->getContent(), true)['code']==='reset_scope_changed'
        && $service->summary($other->id)['available']===0, 'A different same-count grant target received credits');
    $r = $call($endpoint, $grant, $adminToken);
    $assert($r->getStatusCode()===200, 'Grant failed: '.$r->getContent());
    $assert($service->summary($user->id)['available']===2, 'Grant count wrong');
    $assert($service->summary($other->id)['available']===0, 'Grant leaked to other user');
    $assert($call($creditsUrl.'?user_id='.$user->id, null)->getStatusCode() === 403
        && $call($creditsUrl.'?user_id='.$user->id, null, $token)->getStatusCode() === 403, 'Non-admin could read reset credit inventory');
    $assert($call($creditsUrl, null, $adminToken)->getStatusCode() === 422
        && $call($creditsUrl.'?user_id=0', null, $adminToken)->getStatusCode() === 422, 'Credit query accepted a missing or invalid user ID');
    $emptyCredits = ['available' => 0, 'next_expires_at' => null, 'next_expires_count' => 0];
    $permanentCredits = ['available' => 2, 'next_expires_at' => null, 'next_expires_count' => 0];
    $assert($readCredits($other->id) === $emptyCredits, 'Empty inventory mixed credits from another account');
    $assert($readCredits($user->id) === $permanentCredits, 'Permanent credits were reported as expiring');
    $firstExpiry = time() + 3600;
    $adminScope = $service->previewGrant(User::whereKey($admin->id), $admin->id, 1);
    foreach ([[2, $firstExpiry], [3, $firstExpiry], [4, $firstExpiry + 3600], [5, null], [6, time() - 1]] as [$quantity, $expiry]) {
        $service->batch(User::whereKey($admin->id), $admin->id, [
            'kind' => 'grant', 'request_key' => (string)Str::uuid(), 'scope_token' => $adminScope['scope_token'],
            'expected_count' => 1, 'quantity' => $quantity, 'expires_at' => $expiry,
        ]);
    }
    $service->consume($admin->id, (string)Str::uuid());
    $assert($readCredits($admin->id) === ['available' => 13, 'next_expires_at' => $firstExpiry, 'next_expires_count' => 4],
        'Inventory did not sum the remaining credits, grouping all batches expiring at the earliest instant');
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===200 && $service->summary($user->id)['available']===2, 'Grant retry duplicated');
    $grant['quantity']=3;
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===422, 'Reused key allowed different payload');
    $grant['request_key']=(string)Str::uuid(); $grant['expected_count']=2;
    $assert($call($endpoint, $grant, $adminToken)->getStatusCode()===422 && $service->summary($user->id)['available']===2, 'Count mismatch partially granted: '.json_encode($service->summary($user->id)));
    $before = $user->refresh()->only(['expired_at','transfer_enable','plan_id','token','uuid','balance','credit_balance']);
    $soonGrant = ['kind'=>'grant','request_key'=>(string)Str::uuid(),'expected_count'=>1,'quantity'=>1,'expires_at'=>time()+3600];
    $soonGrant['scope_token'] = $grant['scope_token'];
    $service->batch(User::where('id',$user->id),$admin->id,$soonGrant);
    $soon = DB::table('v2_usage_reset_credit')->where('user_id',$user->id)->whereNotNull('expires_at')->first();
    $key=(string)Str::uuid();
    $beforeConsume = time();
    $r=$call('/api/v10/me/usage-resets/consumptions',['requestKey'=>$key,'user_id'=>$other->id],$token);
    $assert($r->getStatusCode()===200,'Consume failed: '.$r->getContent());
    $assert($user->refresh()->u===0 && $user->d===0,'Usage not cleared');
    $consumeAnchor = $user->traffic_reset_anchor_at;
    $assert($consumeAnchor >= $beforeConsume && $consumeAnchor <= time(),'Consumption did not save the new reset cycle');
    $zone = new DateTimeZone(App\Services\TimeZones::system());
    $anchorDate = (new DateTimeImmutable('@'.$consumeAnchor))->setTimezone($zone);
    $nextMonth = $anchorDate->modify('first day of next month')->setTime(0, 0);
    $nextReset = $nextMonth->modify('+'.(min((int)$anchorDate->format('j'), (int)$nextMonth->format('t'))-1).' days')->getTimestamp();
    $assert((new App\Services\UserService())->getResetInfo($user)['at'] === $nextReset,'Consumption did not move the displayed reset to its new monthly date');
    $subscriptionResponse = $call('/api/v10/me/subscription', null, $token);
    $subscription = json_decode($subscriptionResponse->getContent(), true)['data'] ?? [];
    $expectedDays = $anchorDate->setTime(0, 0)->diff((new DateTimeImmutable('@'.$nextReset))->setTimezone($zone))->days;
    $assert($subscriptionResponse->getStatusCode() === 200 && ($subscription['resetAt'] ?? null) === gmdate('Y-m-d\TH:i:s\Z', $nextReset)
        && ($subscription['resetDay'] ?? null) === $expectedDays && !array_key_exists('traffic_reset_anchor_at', $subscription),
        'Authenticated subscription did not expose the anchored reset consistently');
    $assert($user->only(array_keys($before))===$before,'Subscription or credentials changed');
    $assert($other->refresh()->u===10 && $other->d===20,'Other account was reset');
    $assert(DB::table('v2_usage_reset_credit')->where('id',$soon->id)->value('remaining')===0,'Expiring credit not used first');
    $assert($readCredits($user->id) === $permanentCredits, 'A depleted credit still affected the next expiry');
    $user->update(['u'=>50]);
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>$key],$token)->getStatusCode()===200 && $user->refresh()->u===50,'Retry reset newly accrued usage');
    $assert($service->summary($user->id)['available']===2,'Retry consumed a second credit');
    $assert($user->traffic_reset_anchor_at === $consumeAnchor,'Retry moved the reset cycle again');
    $target = ['user_id' => $user->id];
    $assert($call($logsUrl($target), null)->getStatusCode() === 403
        && $call($logsUrl($target), null, $token)->getStatusCode() === 403, 'Usage reset audit allowed a non-admin');
    $assert($call($logsUrl([]), null)->getStatusCode() === 403
        && $call($logsUrl([]), null, $token)->getStatusCode() === 403, 'Site-wide reset history allowed a non-admin');
    foreach ([['user_id' => ''], ['email' => ''], ['user_id' => 0], ['user_id' => [$user->id]], $target + ['kind' => 'paid'],
        $target + ['email' => $other->email], ['email' => 'incomplete'], ['email' => [$user->email]],
        $target + ['from' => 'yesterday'], $target + ['from' => 2, 'to' => 1],
        $target + ['current' => 0], $target + ['pageSize' => 101]] as $invalid) {
        $assert($call($logsUrl($invalid), null, $adminToken)->getStatusCode() === 422, 'Invalid usage reset filters accepted');
    }
    $used = $readLogs($target);
    $usage = $used['data'][0];
    $assert($used['total'] === 1 && count($used['data']) === 1 && $usage['kind'] === 'use' && $usage['quantity'] === -1
        && $usage['actor_id'] === $user->id && $usage['actor_email'] === $user->email && $usage['batch_id'] === $soon->batch_id
        && $usage['u_before'] === 10 && $usage['d_before'] === 20 && !$usage['expiry_known'] && $usage['expires_at'] === null,
        'Default audit list included retries, other event types or incorrect consumption details');
    $expectedFields = ['id','kind','quantity','batch_id','user_id','user_email','actor_id','actor_email','u_before','d_before','created_at','expires_at','expiry_known'];
    $assert(!array_diff(array_keys($usage), $expectedFields) && !array_diff($expectedFields, array_keys($usage)),
        'Audit projection omitted fields or exposed internal data');
    $assert($readLogs(['user_id' => $other->id]) === ['data' => [], 'total' => 0], 'Audit leaked another user’s consumption');
    $assert($readLogs(['email' => ' '.strtoupper($user->email).' ']) === $used,
        'Exact email lookup did not return the same account history as its ID');
    $assert($readLogs(['email' => $other->email]) === ['data' => [], 'total' => 0],
        'Existing user with no consumption must return an empty page');
    $unmatchedEmail = str_replace('@', '+tag@', $user->email);
    $missing = $call($logsUrl(['email' => $unmatchedEmail]), null, $adminToken);
    $assert($missing->getStatusCode() === 404 && (json_decode($missing->getContent(), true)['message'] ?? '') === '未找到匹配该邮箱的用户',
        'Unmatched email was not distinguished from an empty history, or a plus alias matched another account');
    $assert($call($logsUrl(['email' => $user->email]), null, $token)->getStatusCode() === 403,
        'Email lookup exposed account history to a non-admin');
    $granted = $readLogs($target + ['kind' => 'grant']);
    $grants = collect($granted['data'])->keyBy('quantity');
    $assert($granted['total'] === 2 && $grants[1]['actor_id'] === $admin->id && $grants[1]['actor_email'] === $admin->email
        && $grants[1]['expiry_known'] === true && $grants[1]['expires_at'] === $soon->expires_at
        && $grants[2]['expiry_known'] === true && $grants[2]['expires_at'] === null,
        'Audit confused dated grants with permanent grants');

    $old = time() - 45 * 86400;
    $historical = ['user_id' => $other->id, 'actor_id' => 0, 'kind' => 'grant', 'quantity' => 1, 'created_at' => $old];
    $ledger = DB::table('v2_usage_reset_log');
    $first = $ledger->insertGetId($historical);
    $second = $ledger->insertGetId($historical + ['credit_id' => $soon->id]);
    $oldest = $ledger->insertGetId(array_replace($historical, ['created_at' => $old - 1]));
    $historyFilters = ['user_id' => $other->id, 'kind' => 'grant', 'from' => $old, 'to' => $old, 'pageSize' => 1];
    $page = $readLogs($historyFilters);
    $item = $page['data'][0];
    $assert($page['total'] === 2 && count($page['data']) === 1 && $item['id'] === $second
        && $item['actor_id'] === 0 && $item['actor_email'] === null && $item['expiry_known'] === false && $item['expires_at'] === null,
        'Audit lost an old row, a boundary tie or borrowed another user’s credit expiry');
    $nextPage = $readLogs($historyFilters + ['current' => 2]);
    $assert($nextPage['data'][0]['id'] === $first && $nextPage['data'][0]['expiry_known'] === false, 'Missing grant credit shown as permanent');
    $assert($readLogs($historyFilters + ['current' => 3]) === ['data' => [], 'total' => 2], 'Out-of-range audit page changed total');
    $allOldGrants = $readLogs(['user_id' => $other->id, 'kind' => 'grant', 'from' => 0]);
    $assert(array_column($allOldGrants['data'], 'id') === [$second, $first, $oldest], 'Audit pagination did not order by time then id');
    $byEmail = $historyFilters;
    unset($byEmail['user_id']);
    $assert($readLogs($byEmail + ['email' => $other->email]) === $page, 'Email lookup lost pagination, kind or date bounds');
    $removedUserId = User::max('id') + 1;
    $orphanId = $ledger->insertGetId(array_replace($historical, ['user_id' => $removedUserId]));
    $orphan = $readLogs(['user_id' => $removedUserId, 'kind' => 'grant']);
    $assert($orphan['total'] === 1 && $orphan['data'][0]['id'] === $orphanId
        && $orphan['data'][0]['user_id'] === $removedUserId && $orphan['data'][0]['user_email'] === null,
        'Audit history could no longer be queried by ID after the account row disappeared');
    $historicalUse = ['user_id' => $removedUserId, 'actor_id' => $removedUserId, 'kind' => 'use', 'quantity' => -1];
    $outsideWindow = $ledger->insertGetId($historicalUse + ['created_at' => $old - 30 * 86400 - 1]);
    $onBoundary = $ledger->insertGetId($historicalUse + ['created_at' => $old - 30 * 86400]);
    $oldUse = $ledger->insertGetId($historicalUse + ['created_at' => $old]);
    $otherUse = $ledger->insertGetId(array_replace($historicalUse, ['created_at' => $old, 'user_id' => $other->id, 'actor_id' => $other->id]));
    $recent = $readLogs([]);
    $assert($recent['total'] === 2 && collect($recent['data'])->every(fn ($item) => $item['kind'] === 'use')
        && collect($recent['data'])->pluck('user_email', 'user_id')->get($user->id) === $user->email
        && collect($recent['data'])->pluck('user_email', 'user_id')->get($admin->id) === $admin->email,
        'Default activity did not show recent consumption across accounts only');
    $bounded = $readLogs(['to' => $old, 'pageSize' => 2]);
    $assert($bounded['total'] === 3 && array_column($bounded['data'], 'id') === [$otherUse, $oldUse]
        && $bounded['data'][1]['user_email'] === null, 'Site-wide window or same-second paging lost historical users');
    $next = $readLogs(['to' => $old, 'pageSize' => 2, 'current' => 2]);
    $assert($next['total'] === 3 && array_column($next['data'], 'id') === [$onBoundary],
        'A to-only lookup did not include exactly the preceding 30 days');
    $fullUser = $readLogs(['user_id' => $removedUserId]);
    $assert(array_column($fullUser['data'], 'id') === [$oldUse, $onBoundary, $outsideWindow],
        'Personal audit history incorrectly inherited the site-wide lookback');
    $grantWindow = $readLogs(['kind' => 'grant', 'from' => $old, 'to' => $old]);
    $assert($grantWindow['total'] === 3 && array_column($grantWindow['data'], 'id') === [$orphanId, $second, $first],
        'Explicit site-wide grant filter did not respect its date range');
    $paidReset = App\Models\Order::create([
        'user_id'=>$other->id, 'plan_id'=>$plan->id, 'trade_no'=>App\Utils\Helper::generateOrderNo(),
        'currency'=>$other->currency ?: 'CNY', 'period'=>'reset_price', 'type'=>4, 'status'=>1, 'paid_at'=>time(), 'total_amount'=>100,
    ]);
    $otherExpiry = $other->expired_at;
    $beforePaidReset = time();
    (new App\Services\OrderService($paidReset))->open();
    $other->refresh();
    $paidAnchor = $other->traffic_reset_anchor_at;
    $assert((int)$paidReset->fresh()->status === 3 && $other->u === 0 && $other->d === 0
        && $paidAnchor >= $beforePaidReset && $paidAnchor <= time() && $other->expired_at === $otherExpiry,
        'Paid reset did not clear usage and start a cycle without extending subscription');
    $other->update(['u'=>20]);
    (new App\Services\OrderService($paidReset))->open();
    $assert($other->refresh()->u === 20 && $other->traffic_reset_anchor_at === $paidAnchor,'Paid reset retry applied usage reset or changed anchor');
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
    $assert($readCredits($user->id) === $emptyCredits, 'Expired credits remained in the administrator summary');
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>(string)Str::uuid()],$token)->getStatusCode()===422,'Expired credits usable');
    $assert($call('/api/v10/me/usage-resets/consumptions',['requestKey'=>'bad'], $token)->getStatusCode()===422,'Invalid idempotency key accepted');
    $all=['kind'=>'global','request_key'=>(string)Str::uuid(),'expected_count'=>User::count(),'confirmation'=>'RESET ALL USAGE'];
    $wrong=$all; unset($wrong['confirmation']);
    $assert($call($endpoint,$wrong,$adminToken)->getStatusCode()===422,'Unconfirmed global reset accepted');
    $r=$call($endpoint,$all,$adminToken);
    $assert($r->getStatusCode()===200,'Global reset failed: '.$r->getContent());
    $assert($user->refresh()->u===0 && $other->refresh()->u===0,'Global reset did not affect all accounts');
    $assert($other->traffic_reset_anchor_at === $paidAnchor,'Global reset moved the paid reset cycle');
    $assert(DB::table('v2_usage_reset_log')->where('user_id',$user->id)->where('kind','global')->value('u_before')===100,'Global audit lost prior usage');
    $global = $readLogs($target + ['kind' => 'global']);
    $assert($global['total'] === 1 && $global['data'][0]['actor_id'] === $admin->id && $global['data'][0]['quantity'] === 0
        && $global['data'][0]['u_before'] === 100 && $global['data'][0]['expiry_known'] === false,
        'Global reset not distinguishable from using a credit');
    $allGlobal = $readLogs(['kind' => 'global', 'pageSize' => 100]);
    $otherGlobal = collect($allGlobal['data'])->firstWhere('user_id', $other->id);
    $assert($allGlobal['total'] === $all['expected_count'] && $otherGlobal['user_email'] === $other->email
        && $otherGlobal['actor_email'] === $admin->email && $otherGlobal['actor_id'] === $admin->id,
        'Site-wide global reset merged affected users or confused their identities with the administrator');
    $assert($readLogs([]) === $recent, 'Global reset rows displaced personal consumptions in the default view');
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
