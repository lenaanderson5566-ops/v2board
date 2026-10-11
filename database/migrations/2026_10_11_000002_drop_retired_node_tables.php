<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public const TABLES = [
        'v2_server_shadowsocks', 'v2_server_vmess', 'v2_server_vless',
        'v2_server_trojan', 'v2_server_tuic', 'v2_server_hysteria', 'v2_server_anytls',
    ];

    public function up(): void {
        foreach (self::TABLES as $table) Schema::dropIfExists($table);
    }

    public function down(): void {
        throw new \LogicException('Retired node data cannot be restored by rollback; restore a database backup.');
    }
};
