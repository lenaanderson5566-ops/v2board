<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_telegram_preference')) Schema::create('v2_telegram_preference', function (Blueprint $t) {
            $t->unsignedBigInteger('user_id')->primary();
            $t->bigInteger('telegram_id');
            $t->boolean('expiry')->default(false);
            $t->boolean('ticket')->default(false);
            $t->boolean('order')->default(false);
            $t->boolean('quiet')->default(true);
            $t->boolean('blocked')->default(false);
            $t->unsignedInteger('updated_at');
        });
        if (!Schema::hasTable('v2_telegram_notification')) Schema::create('v2_telegram_notification', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->char('event_key',64)->unique();
            $t->unsignedBigInteger('user_id');
            $t->bigInteger('telegram_id');
            $t->string('kind',24);
            $t->unsignedBigInteger('reference_id')->nullable();
            $t->string('status',16)->default('pending');
            $t->unsignedInteger('attempts')->default(0);
            $t->unsignedInteger('next_at')->index();
            $t->unsignedInteger('created_at')->index();
            $t->unsignedInteger('finished_at')->nullable();
            $t->string('error_code',32)->nullable();
            $t->index(['status','next_at','id'],'telegram_notification_due');
        });
    }
    public function down(): void {
        Schema::dropIfExists('v2_telegram_notification');
        Schema::dropIfExists('v2_telegram_preference');
    }
};
