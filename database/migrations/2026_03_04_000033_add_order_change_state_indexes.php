<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('v2_order', function (Blueprint $table) {
            $table->index(['type', 'status'], 'idx_order_type_status');
            $table->index(['change_direction', 'change_apply_mode'], 'idx_order_change_dir_mode');
            $table->index(['change_effective_at', 'change_applied_at'], 'idx_order_change_effective_applied');
        });
    }

    public function down(): void
    {
        Schema::table('v2_order', function (Blueprint $table) {
            $table->dropIndex('idx_order_type_status');
            $table->dropIndex('idx_order_change_dir_mode');
            $table->dropIndex('idx_order_change_effective_applied');
        });
    }
};
