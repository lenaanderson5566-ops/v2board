<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateLoginLogTable extends Migration
{
    public function up()
    {
        Schema::create('v2_login_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('email')->nullable()->index();
            $table->string('ip', 45)->nullable()->index();
            $table->string('login_domain')->nullable();
            $table->string('country')->nullable();
            $table->string('region')->nullable();
            $table->string('city')->nullable();
            $table->string('asn')->nullable();
            $table->string('isp')->nullable();
            $table->text('user_agent')->nullable();
            $table->boolean('is_success')->default(false)->index();
            $table->string('reason')->nullable();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_login_log');
    }
}
