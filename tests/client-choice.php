<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
$service = new App\Services\ClientStrategyService();
$assert = function ($value) { if (!$value) throw new RuntimeException('Client policy check failed'); };
Illuminate\Support\Facades\DB::beginTransaction();
try {
    $service->syncStrategies();
    $assert(isset($service->scanProtocols()['flclash']));
    App\Models\ClientStrategy::whereIn('client_type', ['meta', 'flclash', 'verge'])->update(['is_enabled'=>1, 'min_version'=>null]);
    $assert($service->isEnabled('flclash'));
    App\Models\ClientStrategy::where('client_type','flclash')->update(['min_version'=>'0.8.0']);
    $assert(!$service->isVersionAllowed('flclash', '0.7.0'));
    $assert($service->isVersionAllowed('flclash', '0.8.0'));
    $assert($service->frontendPolicies()['flclash']['minVersion'] === '0.8.0');
    App\Models\ClientStrategy::where('client_type','meta')->update(['is_enabled'=>0]);
    $assert(!$service->isEnabled('flclash') && !$service->isEnabled('verge'));
    $assert(!$service->frontendPolicies()['flclash']['enabled']);
    $assert(!$service->frontendPolicies()['clash']['enabled']);
    $assert(!$service->frontendPolicies()['cmfa']['enabled']);
    $method = new ReflectionMethod(App\Services\Actions\Client\ClientActions::class, 'resolveProtocolFlag');
    $method->setAccessible(true);
    $controller = new App\Services\Actions\Client\ClientActions();
    $assert($method->invoke($controller, 'FlClash/0.8.0') === 'flclash');
    $assert($method->invoke($controller, 'clash-verge/2.0') === 'verge');
    echo "PASS client choice and backend policy checks\n";
} finally { Illuminate\Support\Facades\DB::rollBack(); }
