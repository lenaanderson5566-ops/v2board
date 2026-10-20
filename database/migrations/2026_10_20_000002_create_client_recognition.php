<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_client_recognition')) Schema::create('v2_client_recognition',function(Blueprint $t) {
            $t->unsignedInteger('id')->primary();$t->text('rules');$t->unsignedInteger('version')->default(0);$t->unsignedInteger('updated_by');$t->unsignedBigInteger('updated_at');
        });
    }
    public function down(): void { Schema::dropIfExists('v2_client_recognition'); }
};
