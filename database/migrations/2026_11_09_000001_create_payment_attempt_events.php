<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_payment_attempt_event')) return;

        Schema::create('v2_payment_attempt_event', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('order_id');
            $table->unsignedInteger('payment_id')->nullable();
            $table->string('provider', 64)->nullable();
            $table->string('stage', 24);
            $table->string('result', 24);
            $table->string('reason', 48)->nullable();
            $table->uuid('request_id')->nullable();
            $table->uuid('previous_request_id')->nullable();
            $table->string('gateway_host', 253)->nullable();
            $table->unsignedSmallInteger('gateway_http_status')->nullable();
            $table->integer('gateway_code')->nullable();
            $table->string('gateway_order', 64)->nullable();
            $table->string('gateway_actions', 40)->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->unsignedInteger('created_at')->index();
            $table->index(['order_id', 'created_at', 'id'], 'payment_attempt_order');
            $table->index(['payment_id', 'result', 'created_at', 'id'], 'payment_attempt_channel');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_payment_attempt_event');
    }
};
