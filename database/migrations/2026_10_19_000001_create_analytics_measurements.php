<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (Schema::hasTable('v2_analytics_measurement')) return;
        Schema::create('v2_analytics_measurement', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('session_id');
            $table->string('page',32);
            $table->string('event',24);
            $table->unsignedInteger('bucket');
            $table->unsignedInteger('samples')->default(1);
            $table->unsignedBigInteger('value_sum')->default(0);
            $table->unique(['session_id','page','event','bucket'],'analytics_measurement_bucket');
        });
    }
    public function down(): void { Schema::dropIfExists('v2_analytics_measurement'); }
};
