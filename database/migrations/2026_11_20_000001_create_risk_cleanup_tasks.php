<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_risk_cleanup_task')) {
            Schema::create('v2_risk_cleanup_task', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('admin_id');
                $table->char('token_hash', 64)->unique('risk_cleanup_token');
                $table->string('state', 16);
                $table->unsignedBigInteger('matched')->default(0);
                $table->unsignedBigInteger('deleted')->default(0);
                $table->unsignedBigInteger('skipped')->default(0);
                $table->unsignedInteger('expires_at');
                $table->unsignedInteger('created_at');
                $table->unsignedInteger('updated_at');
                $table->index(['admin_id', 'state', 'id'], 'risk_cleanup_admin_state');
                $table->index(['state', 'updated_at'], 'risk_cleanup_state_updated');
            });
        }

        if (!Schema::hasTable('v2_risk_cleanup_item')) {
            Schema::create('v2_risk_cleanup_item', function (Blueprint $table) {
                $table->unsignedBigInteger('task_id');
                $table->unsignedBigInteger('risk_hit_id');
                $table->char('version', 64);
                $table->primary(['task_id', 'risk_hit_id']);
                $table->foreign('task_id', 'risk_cleanup_item_task')
                    ->references('id')->on('v2_risk_cleanup_task')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('v2_risk_cleanup_item');
        Schema::dropIfExists('v2_risk_cleanup_task');
    }
};
