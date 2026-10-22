<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (Schema::hasTable('v2_node_maintenance')) return;
        Schema::create('v2_node_maintenance', function (Blueprint $table) {
            $table->string('type', 16);
            $table->unsignedInteger('node_id');
            $table->string('reason', 200)->default('');
            $table->boolean('hide_subscription')->default(false);
            $table->unsignedInteger('ends_at');
            $table->unsignedInteger('updated_at');
            $table->primary(['type', 'node_id']);
        });
    }
    public function down(): void { Schema::dropIfExists('v2_node_maintenance'); }
};
