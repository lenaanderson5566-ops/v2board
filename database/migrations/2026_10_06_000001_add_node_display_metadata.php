<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    private const TABLES = ['v2_server_shadowsocks', 'v2_server_vmess', 'v2_server_vless', 'v2_server_trojan', 'v2_server_tuic', 'v2_server_hysteria', 'v2_server_anytls', 'v2_server_v2node'];
    public function up(): void {
        foreach (self::TABLES as $name) {
            foreach (['region_code'=>2, 'city_code'=>64, 'display_label'=>64] as $field=>$length) {
                if (!Schema::hasColumn($name, $field)) Schema::table($name, function (Blueprint $table) use ($field, $length) { $table->string($field, $length)->nullable(); });
            }
        }
    }
    public function down(): void {
        foreach (self::TABLES as $name) foreach (['region_code', 'city_code', 'display_label'] as $field) {
            if (Schema::hasColumn($name, $field)) Schema::table($name, fn (Blueprint $table) => $table->dropColumn($field));
        }
    }
};
