<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\User;
use App\Services\TrafficCreditService as Credits;
use App\Services\ServerService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
$checks = 0;
$assert = function ($ok, $label) use (&$checks) { if (!$ok) throw new RuntimeException($label); $checks++; };
$previous = config('v2board.credit_base_group_id');
DB::beginTransaction();
try {
    $basic = DB::table('v2_server_group')->insertGetId(['name'=>'Credit access basic', 'created_at'=>time(), 'updated_at'=>time()]);
    $premium = DB::table('v2_server_group')->insertGetId(['name'=>'Credit access premium', 'created_at'=>time(), 'updated_at'=>time()]);
    config(['v2board.credit_base_group_id'=>$basic]);
    $make = function ($fields=[]) use ($premium) { return User::create(array_merge([
        'email'=>'access-'.Str::uuid().'@example.test', 'password'=>'test-only', 'token'=>Str::random(32), 'uuid'=>(string)Str::uuid(),
        'group_id'=>$premium, 'transfer_enable'=>1000, 'u'=>1000, 'd'=>0, 'expired_at'=>time()+3600, 'credit_balance'=>500, 'banned'=>0,
    ], $fields)); };
    $server = new ServerService();
    $has = function ($group,$user) use ($server) { return $server->getAvailableUsers([$group])->contains('id',$user->id); };
    $active = $make();
    $assert(Credits::effectiveGroupId($active)===$premium && $has($premium,$active) && !$has($basic,$active), 'Exhausted active subscription lost premium access');
    $active->expired_at = time(); $active->save();
    $assert(Credits::effectiveGroupId($active)===$basic && $has($basic,$active) && !$has($premium,$active), 'Expired credits retained premium access');
    $copy = Credits::forClient($active);
    $assert($copy->group_id===$basic && $copy->expired_at===null && $active->group_id===$premium, 'Client effective access mutated stored profile');
    $active->expired_at = time()+3600; $active->save();
    $assert($has($premium,$active) && !$has($basic,$active) && $active->credit_balance===500, 'Renewal did not restore premium access');
    $standalone=$make(['transfer_enable'=>0,'expired_at'=>null]);
    $assert($has($basic,$standalone) && !$has($premium,$standalone), 'Standalone credits not basic');
    $legacy=$make(['transfer_enable'=>0,'expired_at'=>null,'credit_migrated_at'=>time()]);
    $assert($has($basic,$legacy) && Credits::effectiveGroupId($legacy)===$basic, 'Migrated credits bypassed policy');
    $nodeFields=['name'=>'Credit node test','host'=>'example.invalid','port'=>'443','server_port'=>443,'rate'=>1,'show'=>1,'tls'=>0,'network'=>'tcp'];
    $basicNode=App\Models\ServerVmess::create($nodeFields+['group_id'=>[$basic]]);
    $premiumNode=App\Models\ServerVmess::create($nodeFields+['group_id'=>[$premium]]);
    $visible=array_column($server->getAvailableVmess($standalone),'id');
    $assert(in_array($basicNode->id,$visible) && !in_array($premiumNode->id,$visible),'Client node list exposes premium nodes to credits');
    $visible=array_column($server->getAvailableVmess($active),'id');
    $assert(in_array($premiumNode->id,$visible) && !in_array($basicNode->id,$visible),'Active subscriber node list lost premium');
    $banned=$make(['banned'=>1,'expired_at'=>time()-1]);
    $assert(!$has($basic,$banned) && !$has($premium,$banned),'Banned user authorized');
    $empty=$make(['credit_balance'=>0,'expired_at'=>time()-1]);
    $assert(!$has($basic,$empty) && !$has($premium,$empty),'Empty expired account authorized');
    $ordinary=$make(['credit_balance'=>0,'u'=>0]);
    $assert($has($premium,$ordinary),'Normal subscription denied');
    // Expiry must deny access even while the original unused allowance is retained.
    $ordinary->expired_at=time();$ordinary->save();
    $assert(!$has($premium,$ordinary) && !(new App\Services\UserService())->isAvailable($ordinary->fresh()),'Expiry boundary authorizes retained plan allowance');
    $assert((int)$ordinary->fresh()->transfer_enable===1000,'Expiry checks should not erase historical allowance');
    $ordinary->expired_at=time()-3600;$ordinary->save();
    $assert(!User::whereKey($ordinary->id)->withUsableTraffic()->exists(),'Expired unused plan allowance authorized');
    $ordinary->expired_at=time()+3600;$ordinary->save();
    $assert($has($premium,$ordinary),'Renewed plan access was not restored');
    $assert($server->getAvailableUsers([$basic,$premium])->where('id',$active->id)->count()===1,'Shared node duplicated user');
    $assert($server->getAvailableUsers([])->isEmpty(),'Empty group authorized users');
    config(['v2board.credit_base_group_id'=>null]);
    $assert(Credits::effectiveGroupId($standalone)===$premium && $has($premium,$standalone),'Unconfigured rollout changed access');
    config(['v2board.credit_base_group_id'=>$basic]);
    $rule = App\Http\Requests\Admin\ConfigSave::RULES['credit_base_group_id'];
    $assert(validator(['credit_base_group_id'=>$basic],['credit_base_group_id'=>$rule])->passes(),'Valid base group rejected');
    $assert(validator(['credit_base_group_id'=>-1],['credit_base_group_id'=>$rule])->fails(),'Invalid base group accepted');
    $request=Illuminate\Http\Request::create('/','POST',['id'=>$basic]);
    try { (new App\Http\Controllers\V1\Admin\Server\GroupController())->drop($request); throw new RuntimeException('Configured base group deleted'); }
    catch (Symfony\Component\HttpKernel\Exception\HttpException $e) { $assert($e->getStatusCode()===422,'Wrong group deletion response'); }
    echo "PASS: {$checks} credit access checks\n";
} finally {
    DB::rollBack();
    config(['v2board.credit_base_group_id'=>$previous]);
}
