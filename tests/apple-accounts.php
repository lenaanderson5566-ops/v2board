<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\Http;
use App\Services\AppleAccountService;
use App\Services\UserService;
use App\Models\User;
$checks = 0;
$assert = function ($ok) use (&$checks) { if (!$ok) throw new RuntimeException('Check failed: '.($checks + 1)); $checks++; };
config(['v2board.apple_account_token' => 'test-only', 'v2board.apple_account_share' => 'chosen']);
Http::fake(function ($request) use ($assert) {
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
$accounts = (new AppleAccountService)->accounts();
$assert(count($accounts) === 1 && $accounts[0]['username'] === 'allowed');
$assert(!isset($accounts[0]['private']));
foreach ([[0,time()+100,100,0,true],[0,time()-100,100,1,true],[0,time()-100,100,0,false],[1,time()+100,100,100,false]] as [$banned,$expiry,$quota,$credits,$expected]) {
    $user = new User; $user->banned=$banned; $user->expired_at=$expiry; $user->transfer_enable=$quota; $user->credit_balance=$credits;
    $assert((new UserService)->isAvailable($user) === $expected);
}
foreach ([['ret'=>0,'msg'=>'sensitive upstream text'], ['ret'=>1,'data'=>[]]] as $body) {
    Http::swap(new Illuminate\Http\Client\Factory);
    Http::fake(['*'=>Http::response($body)]);
    try { (new AppleAccountService)->accounts(); $assert(false); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===503 && !str_contains($e->getMessage(),'sensitive')); }
}
echo "Apple account checks passed: {$checks}\n";
