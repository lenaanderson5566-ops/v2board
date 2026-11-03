<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_user', 'traffic_reset_anchor_at')) {
            Schema::table('v2_user', function (Blueprint $table) {
                $table->unsignedBigInteger('traffic_reset_anchor_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('v2_user', 'traffic_reset_anchor_at')) {
            Schema::table('v2_user', function (Blueprint $table) {
                $table->dropColumn('traffic_reset_anchor_at');
            });
        }
    }
};
