<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (Schema::hasTable('v2_payment_callback_event')) return;
        Schema::create('v2_payment_callback_event', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('order_id')->nullable();
            $table->unsignedInteger('payment_id')->nullable();
            $table->string('provider', 64);
            $table->string('stage', 24);
            $table->string('result', 24);
            $table->string('reason', 64)->nullable();
            $table->string('request_id', 36)->nullable();
            $table->unsignedInteger('created_at');
            $table->index(['order_id', 'created_at']);
            $table->index(['payment_id', 'created_at']);
            $table->index('created_at');
        });
    }
    public function down(): void { Schema::dropIfExists('v2_payment_callback_event'); }
};
