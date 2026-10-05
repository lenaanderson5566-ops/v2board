<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_invitation_reward')) Schema::create('v2_invitation_reward', function (Blueprint $table) {
            $table->increments('id');
            $table->integer('user_id')->unique();
            $table->integer('invitation_id')->unique();
            $table->unsignedBigInteger('registration_bytes')->default(0);
            $table->unsignedBigInteger('first_use_bytes')->default(0);
            $table->unsignedInteger('first_use_at')->nullable();
            $table->unsignedInteger('created_at');
        });
    }
    public function down(): void { throw new RuntimeException('Invitation reward balances require a coordinated backup restore.'); }
};
