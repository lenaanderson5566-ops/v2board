<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('v2_lightsail_server', function (Blueprint $t) {
            $t->increments('id');
            $t->string('name', 100);
            $t->string('region', 40);
            $t->string('instance', 255);
            $t->text('credentials');
            $t->unique(['region', 'instance']);
            $t->string('node_type', 10);
            $t->unsignedInteger('node_id');
            $t->unique(['node_type', 'node_id']);
            $t->string('status', 40)->default('ready');
            $t->string('phase', 40)->default('idle');
            $t->string('old_name', 255)->nullable();
            $t->string('new_name', 255)->nullable();
            $t->string('current_ip', 45)->nullable();
            $t->string('error_code', 50)->nullable();
            $t->string('operation', 10)->default('rotate');
            $t->unsignedBigInteger('operation_at')->default(0);
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('v2_lightsail_server');
    }
};
