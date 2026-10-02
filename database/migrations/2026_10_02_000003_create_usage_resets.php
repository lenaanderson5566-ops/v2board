<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_usage_reset_batch')) Schema::create('v2_usage_reset_batch', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('request_key', 64)->unique();
            $table->integer('actor_id');
            $table->string('kind', 16);
            $table->string('payload_hash', 64);
            $table->integer('affected')->default(0);
            $table->integer('created_at');
        });
        if (!Schema::hasTable('v2_usage_reset_credit')) Schema::create('v2_usage_reset_credit', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->integer('user_id')->index();
            $table->unsignedBigInteger('batch_id');
            $table->integer('quantity');
            $table->integer('remaining');
            $table->bigInteger('expires_at')->nullable();
            $table->integer('created_at');
            $table->unique(['batch_id', 'user_id']);
        });
        if (!Schema::hasTable('v2_usage_reset_log')) Schema::create('v2_usage_reset_log', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->integer('user_id');
            $table->integer('actor_id');
            $table->unsignedBigInteger('credit_id')->nullable();
            $table->unsignedBigInteger('batch_id')->nullable();
            $table->string('kind', 16);
            $table->integer('quantity')->default(0);
            $table->bigInteger('u_before')->default(0);
            $table->bigInteger('d_before')->default(0);
            $table->string('request_key', 64)->nullable();
            $table->integer('created_at');
            $table->index(['user_id', 'created_at']);
            $table->unique(['user_id', 'request_key']);
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('v2_usage_reset_log');
        Schema::dropIfExists('v2_usage_reset_credit');
        Schema::dropIfExists('v2_usage_reset_batch');
    }
};
