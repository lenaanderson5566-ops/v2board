<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['v2_risk_blacklist_ip', 'v2_risk_blacklist_ua_hash'] as $table) {
            if (!Schema::hasColumn($table, 'expires_at')) {
                Schema::table($table, fn (Blueprint $schema) => $schema->unsignedBigInteger('expires_at')->nullable());
            }
        }
        $userId = collect(Schema::getColumns('v2_subscribe_log'))->firstWhere('name', 'user_id');
        if (!$userId['nullable']) {
            Schema::table('v2_subscribe_log', fn (Blueprint $schema) => $schema->unsignedBigInteger('user_id')->nullable()->change());
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Restore a coordinated backup to preserve blacklist expiry and subscription audit records.');
    }
};
