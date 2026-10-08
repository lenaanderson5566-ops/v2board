<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_user', 'remind_service')) Schema::table('v2_user', function (Blueprint $table) {
            $table->boolean('remind_service')->default(true);
        });
    }
    public function down(): void {
        if (Schema::hasColumn('v2_user', 'remind_service')) Schema::table('v2_user', function (Blueprint $table) {
            $table->dropColumn('remind_service');
        });
    }
};
