<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CreateRiskRuleConfigTable extends Migration
{
    public function up()
    {
        Schema::create('v2_risk_rule_config', function (Blueprint $table) {
            $table->id();
            $table->string('scene')->index();
            $table->string('rule_key')->unique();
            $table->string('name');
            $table->string('description')->nullable();
            $table->string('risk_level')->nullable()->index();
            $table->json('thresholds')->nullable();
            $table->tinyInteger('enabled')->default(1)->index();
            $table->integer('sort')->default(0)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });

        $now = time();
        DB::table('v2_risk_rule_config')->insert([
            [
                'scene' => 'login',
                'rule_key' => 'login_failed_burst_by_ip_10m',
                'name' => '登录失败IP爆发',
                'description' => '同一 IP 10 分钟内登录失败次数 >= 5',
                'risk_level' => 'high',
                'thresholds' => json_encode(['threshold' => 5, 'window_seconds' => 600], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 10,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'scene' => 'login',
                'rule_key' => 'login_account_multi_ip_1h',
                'name' => '账号多IP登录',
                'description' => '同一账号 1 小时内出现的不同登录 IP 数 >= 5',
                'risk_level' => 'medium',
                'thresholds' => json_encode(['threshold' => 5, 'window_seconds' => 3600], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 20,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_high_frequency_by_user_10m',
                'name' => '订阅高频拉取',
                'description' => '同一用户 10 分钟内订阅拉取次数 >= 20',
                'risk_level' => 'medium',
                'thresholds' => json_encode(['threshold' => 20, 'window_seconds' => 600], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 30,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_high_pull_low_traffic_24h',
                'name' => '高拉取低流量',
                'description' => '同一用户 24 小时内订阅成功次数 >= 20 且上下行总流量增长 <= 50MB',
                'risk_level' => 'high',
                'thresholds' => json_encode([
                    'subscribe_threshold' => 20,
                    'traffic_growth_threshold_bytes' => 50 * 1024 * 1024,
                    'window_seconds' => 86400
                ], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 40,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_client_type_spread_24h',
                'name' => '客户端类型扩散',
                'description' => '同一用户 24 小时内订阅客户端类型数量 >= 5',
                'risk_level' => 'low',
                'thresholds' => json_encode(['threshold' => 5, 'window_seconds' => 86400], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 50,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'scene' => 'subscribe',
                'rule_key' => 'subscribe_failed_burst_by_ip_10m',
                'name' => '订阅失败IP爆发',
                'description' => '同一 IP 10 分钟内订阅失败次数 >= 10',
                'risk_level' => 'high',
                'thresholds' => json_encode(['threshold' => 10, 'window_seconds' => 600], JSON_UNESCAPED_UNICODE),
                'enabled' => 1,
                'sort' => 60,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
    }

    public function down()
    {
        Schema::dropIfExists('v2_risk_rule_config');
    }
}
