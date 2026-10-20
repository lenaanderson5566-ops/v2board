<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up() {
        if (!Schema::hasTable('v2_node_credential_state')) Schema::create('v2_node_credential_state', function (Blueprint $t) {
            $t->string('node_type',16); $t->unsignedInteger('node_id');
            $t->primary(['node_type','node_id']);
            $t->unsignedInteger('migrated_at');
        });
        if (!Schema::hasTable('v2_node_credential')) Schema::create('v2_node_credential', function (Blueprint $t) {
            $t->string('id',32)->primary();
            $t->string('node_type',16); $t->unsignedInteger('node_id');
            $t->index(['node_type','node_id']);
            $t->string('secret_hash',64);
            $t->unsignedInteger('created_at'); $t->unsignedInteger('created_by');
            $t->unsignedInteger('last_used_at')->nullable();
            $t->unsignedInteger('expires_at')->nullable();
            $t->unsignedInteger('revoked_at')->nullable();
            $t->unsignedInteger('revoked_by')->nullable();
        });
    }
    public function down() {
        Schema::dropIfExists('v2_node_credential');
        Schema::dropIfExists('v2_node_credential_state');
    }
};
