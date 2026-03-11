<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('v2_user', function (Blueprint $table) {
            $table->string('language', 16)->default('zh-CN')->after('telegram_id');
            $table->index('language', 'idx_language');
        });

        DB::table('v2_user')->whereNull('language')->update(['language' => 'zh-CN']);
    }

    public function down(): void
    {
        Schema::table('v2_user', function (Blueprint $table) {
            $table->dropIndex('idx_language');
            $table->dropColumn('language');
        });
    }
};
