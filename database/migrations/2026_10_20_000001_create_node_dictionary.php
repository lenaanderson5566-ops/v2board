<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_node_dictionary')) Schema::create('v2_node_dictionary',function(Blueprint $t) {
            $t->string('key',80)->primary();$t->text('names');$t->unsignedInteger('version')->default(0);$t->unsignedInteger('updated_by');$t->unsignedBigInteger('updated_at');
        });
    }
    public function down(): void { Schema::dropIfExists('v2_node_dictionary'); }
};
