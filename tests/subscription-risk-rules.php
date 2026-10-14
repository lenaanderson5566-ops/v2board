<?php
$app = require __DIR__.'/support/bootstrap.php';
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use App\Services\RiskLogService;
use App\Models\RiskRuleConfig;
use App\Models\RiskRuleHit;
use Illuminate\Support\Facades\DB;
$n = 0;
$assert = \Tests\Support\Assertions::counter($n);
DB::beginTransaction();
try {
    $service = new RiskLogService();
    $assert(count($service->getRuleDefinitions()) === 4, 'Only four supported rules');
    foreach ($service->getRuleDefinitions() as $rule) $assert($rule['scene'] === 'subscribe', 'No login rules');
    RiskRuleConfig::updateOrCreate(['rule_key'=>'login_failed_burst_by_ip_10m'], ['scene'=>'login','name'=>'old','enabled'=>1,'risk_level'=>'high','thresholds'=>['threshold'=>1,'window_seconds'=>600]]);
    RiskLogService::clearRuleCache();
    $before = RiskRuleHit::count();
    $service->createLoginLog(['email'=>'risk-test@example.com','ip'=>'192.0.2.8','is_success'=>false]);
    $assert(RiskRuleHit::count() === $before, 'Stored legacy login rule cannot trigger');
    $assert(count($service->getRuleDefinitions()) === 4, 'Stored legacy rules remain excluded');
    $assert(RiskLogService::ruleName('subscribe_client_type_spread_24h') === '客户端类型扩散', 'Current rule has Chinese name');
    $assert(str_contains(RiskLogService::ruleName('login_failed_burst_by_ip_10m'), '已停用'), 'Historical rule is labeled retired');
    echo "Subscription risk rules: {$n} checks passed\n";
} finally { DB::rollBack(); RiskLogService::clearRuleCache(); }
