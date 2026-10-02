<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('v2_email_invitation')) return;
        Schema::create('v2_email_invitation', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id')->index();
            $table->string('email', 254);
            $table->string('email_hash', 64);
            $table->string('token_hash', 64)->unique();
            $table->unsignedInteger('accepted_user_id')->nullable();
            $table->unsignedBigInteger('expires_at');
            $table->unsignedBigInteger('sent_at')->nullable();
            $table->unsignedBigInteger('failed_at')->nullable();
            $table->unsignedBigInteger('accepted_at')->nullable();
            $table->unsignedBigInteger('last_requested_at');
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('updated_at');
            $table->unique(['user_id', 'email_hash']);
        });
    }
    public function down(): void { Schema::dropIfExists('v2_email_invitation'); }
};
