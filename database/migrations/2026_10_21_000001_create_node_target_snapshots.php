<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_node_target_snapshot')) Schema::create('v2_node_target_snapshot',function(Blueprint $t) {
            $t->string('id',64)->primary();
            $t->unsignedInteger('node_id'); $t->string('version',36);
            $t->unsignedBigInteger('bucket_at'); $t->unsignedBigInteger('expires_at')->index();
            $t->unsignedInteger('payload_bytes'); $t->longText('payload');
            $t->index(['node_id','version','bucket_at'],'node_target_lookup');
        });
    }
    public function down(): void { Schema::dropIfExists('v2_node_target_snapshot'); }
};
