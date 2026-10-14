<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Models\ClientStrategy;
use App\Models\RiskSetting;
use App\Models\SubscribeLog;
use App\Services\ClientStrategyService;
use Illuminate\Support\Facades\DB;
$n = 0;
$assert = \Tests\Support\Assertions::counter($n);
DB::beginTransaction();
try {
    RiskSetting::where('key', 'client_access_unified')->delete();
    ClientStrategy::query()->delete();
    $service = new ClientStrategyService();
    config(['v2board.subscription_ua_whitelist_enabled'=>1, 'v2board.subscription_ua_whitelist'=>['flclash']]);
    $rows = $service->getStrategies()->keyBy('client_type');
    $assert(!$rows['clash-party']->is_enabled && !$rows['throne']->is_enabled && !$rows['nekobox']->is_enabled && !$rows['husi']->is_enabled, 'New clients are disabled before first policy save');
    $assert(ClientStrategy::count() === 0, 'GET does not create rows');
    $assert($rows['flclash']->is_enabled && !$rows['mihomo']->is_enabled, 'Existing whitelist preserved without blocking permitted app');
    $assert(!$service->frontendPolicies()['cmfa']['enabled'], 'Recommendations use effective access');
    $service->updateStrategies([['client_type'=>'flclash','min_version'=>'0.8.0']]);
    $assert(RiskSetting::where('key','client_access_unified')->exists(), 'First save imports legacy policy');
    $assert(ClientStrategy::where('is_enabled',1)->pluck('client_type')->all() === ['flclash'], 'Migration does not broaden access');
    config(['v2board.subscription_ua_whitelist'=>['mihomo']]);
    $assert($service->isEnabled('flclash') && !$service->isEnabled('mihomo'), 'Retired whitelist no longer overrides saved policy');
    $service->updateStrategies([['client_type'=>'sing-box','is_enabled'=>true]]);
    $assert($service->isEnabled('sing-box'), 'One switch allows access');
    ClientStrategy::where('client_type','v2rayn')->delete();
    $assert(!$service->isEnabled('v2rayn'), 'Unconfigured clients fail closed after unification');
    $service->updateStrategies([['client_type'=>'flclash','is_enabled'=>false]]);
    $assert($service->accessDenial('mihomo','FlClash/0.8.0') === 'client_disabled', 'One switch denies access');
    $assert(!$service->frontendPolicies()['flclash']['enabled'], 'Disabled client excluded from recommendations');
    $assert(!$service->isEnabled('v2rayn'), 'Saving another client does not enable a new registry entry');
    $assert(validator(['subscription_ua_whitelist'=>[]], App\Http\Requests\Admin\ConfigSave::RULES)->fails(), 'Retired configuration cannot clear the legacy restriction');
    $before = ClientStrategy::where('client_type','sing-box')->value('is_enabled');
    try { $service->updateStrategies([['client_type'=>'sing-box','is_enabled'=>false],['client_type'=>'bogus']]); } catch (Symfony\Component\HttpKernel\Exception\HttpException $e) {}
    $assert(ClientStrategy::where('client_type','sing-box')->value('is_enabled') === $before, 'Invalid batch leaves all rows unchanged');
    RiskSetting::where('key','client_access_unified')->delete();
    config(['v2board.subscription_ua_whitelist_enabled'=>0]);
    ClientStrategy::whereIn('client_type',['flclash','clash-verge'])->update(['is_enabled'=>1]);
    ClientStrategy::where('client_type','mihomo')->update(['is_enabled'=>0]);
    $service->updateStrategies([['client_type'=>'sing-box','sort'=>2]]);
    $assert(!$service->isEnabled('flclash') && !$service->isEnabled('clash-verge'), 'Legacy parent denial preserved on import');
    $service->updateStrategies([['client_type'=>'flclash','is_enabled'=>true]]);
    $assert($service->isEnabled('flclash'), 'After import clients have independent admission');
    SubscribeLog::where('client_type','flclash')->delete();
    $now = time();
    foreach ([['FlClash/0.8.0',$now-10],['FlClash',$now-20],['FlClash/0.7.0',$now-90000]] as [$ua,$at]) {
        SubscribeLog::create(['user_id'=>1,'client_type'=>'flclash','user_agent'=>$ua,'status'=>'success','created_at'=>$at,'updated_at'=>$at]);
    }
    $method = new ReflectionMethod(App\Http\Controllers\V1\Risk\LogController::class, 'appendClientSubscribeStats');
    $method->setAccessible(true);
    $row = $method->invoke(new App\Http\Controllers\V1\Risk\LogController(), $service->getStrategies())->keyBy('client_type')['flclash'];
    $assert($row['ua_version_recognized_24h'] === 1 && str_starts_with($row['ua_version_coverage_24h'],'50%'), 'Version recognition weighted over 24h requests');
    $assert($row['ua_last_seen_at'] === $now-10, 'Last seen comes from logs');
    $assert(str_contains($row['ua_observation'],'不证明真实性'), 'Observation never authenticates clients');
    $service->updateStrategies([['client_type'=>'clash-party','is_enabled'=>true], ['client_type'=>'clash-verge','sort'=>5]]);
    $assert($service->isEnabled('clash-party') && !$service->isEnabled('mihomo-party'), 'Aliases update the same policy');
    $assert(!ClientStrategy::where('client_type','mihomo-party')->exists() && !ClientStrategy::where('client_type','verge')->exists(), 'Canonical input does not duplicate legacy storage');    echo "Unified access: {$n} checks passed\n";
} finally { DB::rollBack(); }
