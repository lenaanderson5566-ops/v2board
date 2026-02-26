<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateUserOnlineSnapshotTable extends Migration
{
    public function up()
    {
        Schema::create('v2_user_online_snapshot', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('ip', 45)->nullable()->index();
            $table->string('node', 64)->nullable()->index();
            $table->string('source', 16)->default('alive')->index();
            $table->integer('online_at')->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
            $table->unique(['user_id', 'ip', 'node', 'source'], 'v2_user_online_snapshot_unique');
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_user_online_snapshot');
    }
}
