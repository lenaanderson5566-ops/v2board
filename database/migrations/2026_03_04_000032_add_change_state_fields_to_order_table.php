<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('v2_order', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_order', 'change_direction')) {
                $table->tinyInteger('change_direction')->nullable()->comment('1升级2降级3平级')->after('type');
            }
            if (!Schema::hasColumn('v2_order', 'change_apply_mode')) {
                $table->tinyInteger('change_apply_mode')->nullable()->comment('1立即生效2下周期生效')->after('change_direction');
            }
            if (!Schema::hasColumn('v2_order', 'change_effective_at')) {
                $table->unsignedInteger('change_effective_at')->nullable()->after('change_apply_mode');
            }
            if (!Schema::hasColumn('v2_order', 'change_applied_at')) {
                $table->unsignedInteger('change_applied_at')->nullable()->after('change_effective_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('v2_order', function (Blueprint $table) {
            foreach (['change_applied_at', 'change_effective_at', 'change_apply_mode', 'change_direction'] as $column) {
                if (Schema::hasColumn('v2_order', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
