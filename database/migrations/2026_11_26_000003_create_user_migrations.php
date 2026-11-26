<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_user_migration')) {
            return;
        }

        Schema::create('v2_user_migration', function (Blueprint $table) {
            $table->id();
            $table->string('source_site', 64);
            $table->unsignedBigInteger('source_user_id');
            $table->unsignedBigInteger('user_id')->unique('user_migration_user_unique');
            $table->unsignedBigInteger('administrator_id');
            $table->char('currency', 3);
            $table->unsignedInteger('wallet_balance');
            $table->unsignedInteger('before_cutoff_credit');
            $table->unsignedInteger('after_cutoff_credit');
            $table->unsignedBigInteger('cutoff_at');
            $table->unsignedBigInteger('snapshot_at');
            $table->unsignedBigInteger('created_at');
            $table->unique(['source_site', 'source_user_id'], 'user_migration_source_unique');
        });
    }

    public function down(): void
    {
        // Keep credited-account history and duplicate protection on rollback.
    }
};
