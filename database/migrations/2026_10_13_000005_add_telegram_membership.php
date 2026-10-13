<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_telegram_binding_challenge')) Schema::create('v2_telegram_binding_challenge', function (Blueprint $t) {
            $t->unsignedBigInteger('user_id')->primary();
            $t->char('token_hash', 64)->unique();
            $t->bigInteger('telegram_id')->nullable();
            $t->string('telegram_name', 128)->nullable();
            $t->unsignedInteger('expires_at')->index();
        });
        if (!Schema::hasTable('v2_telegram_group_member')) Schema::create('v2_telegram_group_member', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->bigInteger('chat_id');
            $t->bigInteger('telegram_id');
            $t->string('status', 32)->default('pending');
            $t->boolean('policy_banned')->default(false);
            $t->unsignedInteger('next_check_at')->default(0)->index();
            $t->unsignedInteger('checked_at')->nullable();
            $t->string('error_code', 48)->nullable();
            $t->unique(['chat_id', 'telegram_id']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('v2_telegram_binding_challenge');
        Schema::dropIfExists('v2_telegram_group_member');
    }
};
