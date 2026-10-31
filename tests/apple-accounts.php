<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\Http;
use App\Services\AppleAccountService;
use App\Services\UserService;
use App\Models\User;
$checks = 0;
$assert = function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Check failed: '.($checks + 1)); $checks++; };
config(['v2board.apple_account_url' => 'https://apple.example/', 'v2board.apple_account_token' => 'test-only', 'v2board.apple_account_share' => 'chosen']);
$service = new class extends AppleAccountService { protected function resolveHost(string $host): array { return ['93.184.216.34']; } };
Http::fake(function ($request) use ($assert) {
    $assert(str_starts_with($request->url(), 'https://apple.example/client/'));
    $assert($request->hasHeader('X-API-Key', 'test-only'));
    if (str_contains($request->url(), '/client/getAllSharepages')) return Http::response(['ret' => 1, 'data' => [['id'=>7,'share_link'=>'other'],['id'=>9,'share_link'=>'chosen']]]);
    if (str_contains($request->url(), '/client/getShareAccounts?id=9')) return Http::response(['ret'=>1,'data'=>[
        ['username'=>'allowed','password'=>'test','status'=>1,'last_check_success'=>true,'private'=>'never return'],
        ['username'=>'disabled','password'=>'test','status'=>0,'last_check_success'=>true],
        ['username'=>'failed','password'=>'test','status'=>1,'last_check_success'=>false],
        ['username'=>'missing','status'=>1,'last_check_success'=>true],
    ]]);
    throw new RuntimeException('Unexpected request');
});
$accounts = $service->accounts();
$assert(count($accounts) === 4 && $accounts[0]['username'] === 'allowed');
$assert(!isset($accounts[0]['private']));
$assert($accounts[0]['available'] && $accounts[0]['status'] === 'normal');
foreach (array_slice($accounts, 1) as $row) $assert(!$row['available'] && !isset($row['password']));
// All account check times are normalized before the V10 timestamp projection.
$instant = 1793404800; // 2026-10-31T00:00:00Z
$checkedTimes = [$instant, (string) $instant, (float) $instant, '2026-10-31T00:00:00Z',
    '2026-10-31T08:00:00+08:00', '2026-10-30T17:00:00-07:00', '2026-10-31T00:00:00.123456789Z',
    '2026-10-31 08:00:00', '2026-10-31T08:00:00', '2026-02-30T00:00:00Z',
    '2026-10-31T24:00:00Z', '2026-10-31T00:00:00+24:00', 'invalid', '2026-10-31T00:00:00+00:99', 253402300800, 1.5, true, null];
Http::swap(new Illuminate\Http\Client\Factory);
Http::fake(function ($request) use ($checkedTimes) {
    if (str_contains($request->url(), '/client/getAllSharepages')) return Http::response(['ret'=>1,'data'=>[['id'=>9,'share_link'=>'chosen']]]);
    return Http::response(['ret'=>1,'data'=>array_map(fn($value, $index)=>[
        'username'=>'time-'.$index, 'status'=>0, 'last_check'=>$value,
    ], $checkedTimes, array_keys($checkedTimes))]);
});
$originalZone = date_default_timezone_get();
try {
    foreach (['UTC', 'Asia/Shanghai', 'America/Los_Angeles'] as $zone) {
        date_default_timezone_set($zone);
        $normalized = $service->accounts();
        foreach ($normalized as $index=>$row) {
            $assert($row['last_check'] === ($index < 7 ? $instant : null));
            $wire = App\Http\Resources\V10\Resource::encode('apple', $row);
            $assert($wire['lastCheckedAt'] === ($index < 7 ? '2026-10-31T00:00:00Z' : null));
        }
    }
} finally { date_default_timezone_set($originalZone); }
foreach ([[0,time()+100,100,0,true],[0,time()-100,100,1,true],[0,time()-100,100,0,false],[1,time()+100,100,100,false]] as [$banned,$expiry,$quota,$credits,$expected]) {
    $user = new User; $user->banned=$banned; $user->expired_at=$expiry; $user->transfer_enable=$quota; $user->credit_balance=$credits;
    $assert((new UserService)->isAvailable($user) === $expected);
}
foreach ([['ret'=>0,'msg'=>'sensitive upstream text'], ['ret'=>1,'data'=>[]]] as $body) {
    Http::swap(new Illuminate\Http\Client\Factory);
    Http::fake(['*'=>Http::response($body)]);
    try { $service->accounts(); $assert(false); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===503 && !str_contains($e->getMessage(),'sensitive')); }
}
$assert(AppleAccountService::normalizeOrigin('https://APPLE.example:8443/') === 'https://apple.example:8443');
foreach (['http://apple.example', 'https://user:pass@apple.example', 'https://apple.example/client', 'https://apple.example?key=x', 'https://apple.example#x'] as $url) {
    try { AppleAccountService::normalizeOrigin($url); $assert(false); }
    catch (InvalidArgumentException $e) { $assert(true); }
}
foreach (['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1'] as $ip) {
    $blocked = new class($ip) extends AppleAccountService {
        private $ip;
        public function __construct($ip) { $this->ip = $ip; }
        protected function resolveHost(string $host): array { return [$this->ip]; }
    };
    try { $blocked->accounts(); $assert(false); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert(str_contains($e->getMessage(), 'public address')); }
}
echo "Apple account checks passed: {$checks}\n";
