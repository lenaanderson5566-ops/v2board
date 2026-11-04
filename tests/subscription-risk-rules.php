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

    $frequency = 'subscribe_high_frequency_by_user_10m';
    $lowTraffic = 'subscribe_high_pull_low_traffic_24h';
    $spread = 'subscribe_client_type_spread_24h';
    foreach ([$frequency => ['threshold'=>2], $lowTraffic => ['subscribe_threshold'=>2], $spread => ['threshold'=>2]] as $key => $thresholds) {
        $definition = RiskLogService::defaultRuleDefinitions()[$key];
        RiskRuleConfig::updateOrCreate(['rule_key'=>$key], [
            'scene'=>'subscribe', 'name'=>$definition['name'], 'enabled'=>1,
            'risk_level'=>$definition['risk_level'], 'thresholds'=>$thresholds,
        ]);
    }
    RiskLogService::clearRuleCache();
    $userId = 1870000000 + random_int(1, 1000000);
    $ip = '198.51.100.41';
    $attempt = ['user_id'=>$userId, 'email'=>'subscription-review@example.test', 'ip'=>$ip, 'traffic_u'=>100, 'traffic_d'=>200];
    $hits = fn () => RiskRuleHit::where('user_id', $userId);
    $service->createSubscribeLog($attempt + ['client_type'=>'sing-box', 'status'=>'success']);
    $service->createSubscribeLog($attempt + ['client_type'=>'mihomo', 'status'=>'failed']);
    $assert($hits()->pluck('rule_key')->all() === [$frequency], 'Failed attempts count toward frequency without inflating successful client spread or low traffic');
    $service->createSubscribeLog($attempt + ['client_type'=>'fastai', 'status'=>'success', 'reason'=>RiskLogService::CONFIG_CHECK_REASON]);
    $assert($hits()->pluck('rule_key')->all() === [$frequency], 'HEAD revision checks do not count as configuration downloads');

    $service->createSubscribeLog($attempt + ['client_type'=>'flclash', 'status'=>'success']);
    $spreadHit = $hits()->where('rule_key', $spread)->firstOrFail();
    $source = App\Models\SubscribeLog::find($spreadHit->payload['source_log_id'] ?? null);
    $assert($source?->client_type === 'flclash' && (int)$source->user_id === $userId
        && $spreadHit->payload['distinct_client_type_count'] === 2, 'Spread hit links to its triggering successful request');
    $assert($hits()->where('rule_key', $lowTraffic)->firstOrFail()->payload['traffic_growth_bytes'] === 0, 'Low traffic records the successful sample window');
    $service->reviewHit(['id'=>$spreadHit->id, 'state'=>'confirmed', 'note'=>'Reviewed manually'], 1);
    $assert($spreadHit->fresh()->payload['review']['state'] === 'confirmed'
        && !(new App\Services\RiskBlacklistService())->exists('ip', $ip), 'Detection and manual review never add an IP block');
    echo "Subscription risk rules: {$n} checks passed\n";
} finally { DB::rollBack(); RiskLogService::clearRuleCache(); }
