<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateUserConnectionLogTable extends Migration
{
    public function up()
    {
        Schema::create('v2_user_connection_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('ip', 45)->nullable()->index();
            $table->string('node', 64)->nullable()->index();
            $table->string('source', 16)->default('alive')->index();
            $table->integer('connected_at')->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
            $table->index(['user_id', 'connected_at'], 'v2_user_connection_log_user_connected_at_idx');
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_user_connection_log');
    }
}
