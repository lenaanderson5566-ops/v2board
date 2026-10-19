<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (Schema::hasTable('v2_passkey')) return;
        Schema::create('v2_passkey',function(Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedInteger('user_id')->index();
            $t->string('credential_hash',64)->unique();
            $t->text('credential_id');
            $t->text('public_key');
            $t->string('user_handle',64);
            $t->string('rp_id',253);
            $t->string('name',64);
            $t->unsignedBigInteger('sign_count')->default(0);
            $t->unsignedInteger('created_at');
            $t->unsignedInteger('last_used_at')->nullable();
        });
    }
    public function down(): void { Schema::dropIfExists('v2_passkey'); }
};
