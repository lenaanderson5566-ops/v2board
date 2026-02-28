<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        DB::statement('ALTER TABLE `v2_user` MODIFY `last_login_ip` VARCHAR(45) NULL');
    }

    public function down(): void
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        DB::statement('ALTER TABLE `v2_user` MODIFY `last_login_ip` BIGINT UNSIGNED NULL');
    }
};
