<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_notice', 'translations')) Schema::table('v2_notice', function (Blueprint $table) {
            $table->json('translations')->nullable();
        });
        if (!Schema::hasColumn('v2_notice', 'source_language')) Schema::table('v2_notice', function (Blueprint $table) { $table->string('source_language', 10)->default('zh-CN'); });
    }
    public function down(): void {
        if (Schema::hasColumn('v2_notice', 'source_language')) Schema::table('v2_notice', function (Blueprint $table) { $table->dropColumn('source_language'); });
        if (Schema::hasColumn('v2_notice', 'translations')) Schema::table('v2_notice', function (Blueprint $table) { $table->dropColumn('translations'); });
    }
};
