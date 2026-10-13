<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up() {
        if (Schema::hasTable('v2_client_diagnostic_report')) return;
        Schema::create('v2_client_diagnostic_report', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id')->index();
            $table->uuid('report_id')->unique();
            $table->string('client_version', 32);
            $table->string('platform', 16);
            $table->json('checks');
            $table->unsignedInteger('created_at')->index();
        });
    }
    public function down() { Schema::dropIfExists('v2_client_diagnostic_report'); }
};
