<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SeedDefaultUaBlacklist extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_risk_blacklist_ua_hash')) {
            return;
        }

        $defaultUas = [
            "SSD/1.0.0",
            "ShadowsocksX-NG/1.9.4",
            "Surfboard/2.15.0",
            "Surge/4.0.0 (iPhone; iOS 13.0; Scale/3.00)",
            "Loon/2.1.0 (iPhone; iOS 15.0; Scale/3.00)",
            "Shadowrocket/1.9.8 (iPhone; iOS 15.0; Scale/3.00)",
            "v2rayNG/1.8.5",
            "v2rayN/6.23",
            "ClashR/1.4.0",
            "clash-verge/v1.3.8",
        ];

        $now = time();
        foreach ($defaultUas as $ua) {
            DB::table('v2_risk_blacklist_ua_hash')->updateOrInsert(
                ['value' => hash('sha256', $ua)],
                [
                    'ua_raw' => $ua,
                    'remark' => 'default_ua_blacklist',
                    'is_enabled' => 1,
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        }
    }

    public function down()
    {
        if (!Schema::hasTable('v2_risk_blacklist_ua_hash')) {
            return;
        }

        $defaultUas = [
            "SSD/1.0.0",
            "ShadowsocksX-NG/1.9.4",
            "Surfboard/2.15.0",
            "Surge/4.0.0 (iPhone; iOS 13.0; Scale/3.00)",
            "Loon/2.1.0 (iPhone; iOS 15.0; Scale/3.00)",
            "Shadowrocket/1.9.8 (iPhone; iOS 15.0; Scale/3.00)",
            "v2rayNG/1.8.5",
            "v2rayN/6.23",
            "ClashR/1.4.0",
            "clash-verge/v1.3.8",
        ];

        foreach ($defaultUas as $ua) {
            DB::table('v2_risk_blacklist_ua_hash')
                ->where('value', hash('sha256', $ua))
                ->where('remark', 'default_ua_blacklist')
                ->delete();
        }
    }
}
