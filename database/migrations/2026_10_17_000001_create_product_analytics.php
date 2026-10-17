<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('v2_analytics_session', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('session_hash', 64)->unique();
            $table->unsignedInteger('created_at')->index();
            $table->unsignedInteger('last_at');
            $table->string('device', 12);
            $table->string('language', 12);
            $table->unsignedTinyInteger('stage')->default(0);
        });
        Schema::create('v2_analytics_page', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('session_id')->index();
            $table->string('page', 32);
            $table->unsignedInteger('views')->default(1);
            $table->unsignedInteger('created_at')->index();
            $table->unique(['session_id', 'page']);
        });
    }
    public function down(): void {
        Schema::dropIfExists('v2_analytics_page');
        Schema::dropIfExists('v2_analytics_session');
    }
};
