<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::create('v2_node_traffic_batch', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->string('node_type', 10); $t->unsignedInteger('node_id'); $t->uuid('batch_id');
            $t->unique(['node_type','node_id','batch_id'], 'node_traffic_batch_unique');
            $t->char('payload_hash',64); $t->longText('payload')->nullable();
            $t->decimal('rate',10,2); $t->unsignedInteger('record_at');
            $t->unsignedInteger('created_at'); $t->unsignedInteger('processed_at')->nullable()->index();
        });
    }
    public function down(): void { Schema::dropIfExists('v2_node_traffic_batch'); }
};
