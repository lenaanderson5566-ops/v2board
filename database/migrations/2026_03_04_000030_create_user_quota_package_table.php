<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_user_quota_package')) {
            return;
        }

        Schema::create('v2_user_quota_package', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->unsignedBigInteger('order_id')->nullable()->index();
            $table->unsignedBigInteger('plan_id')->nullable()->index();
            $table->unsignedBigInteger('total_bytes');
            $table->unsignedBigInteger('used_bytes')->default(0);
            $table->unsignedBigInteger('remaining_bytes')->default(0)->index();
            $table->string('source', 32)->default('onetime_price');
            $table->unsignedInteger('created_at')->nullable();
            $table->unsignedInteger('updated_at')->nullable();

            $table->index(['user_id', 'remaining_bytes'], 'idx_user_remaining');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_user_quota_package');
    }
};
