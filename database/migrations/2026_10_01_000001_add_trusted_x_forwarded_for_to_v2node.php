<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_server_v2node', 'trusted_x_forwarded_for')) {
            Schema::table('v2_server_v2node', function (Blueprint $table) {
                $table->string('trusted_x_forwarded_for')->nullable()->after('network_settings');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('v2_server_v2node', 'trusted_x_forwarded_for')) {
            Schema::table('v2_server_v2node', function (Blueprint $table) {
                $table->dropColumn('trusted_x_forwarded_for');
            });
        }
    }
};
