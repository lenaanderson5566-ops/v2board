<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_user_mfa')) return;
        Schema::create('v2_user_mfa', function (Blueprint $table) {
            $table->unsignedInteger('user_id')->primary();
            $table->boolean('email_enabled')->default(false);
            $table->text('totp_secret')->nullable();
            $table->text('recovery_hashes')->nullable();
            $table->bigInteger('last_totp_step')->default(-1);
            $table->unsignedInteger('version')->default(0);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('MFA credentials must not be silently removed.');
    }
};
