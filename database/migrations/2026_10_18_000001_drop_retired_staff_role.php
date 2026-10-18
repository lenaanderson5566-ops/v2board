<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_user') && Schema::hasColumn('v2_user', 'is_staff')) {
            Schema::table('v2_user', function (Blueprint $table) {
                $table->dropColumn('is_staff');
            });
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Retired staff role values cannot be recovered; restore a database backup to roll back.');
    }
};
