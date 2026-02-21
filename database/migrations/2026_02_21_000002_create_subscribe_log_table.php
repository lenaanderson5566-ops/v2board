<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateSubscribeLogTable extends Migration
{
    public function up()
    {
        Schema::create('v2_subscribe_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('email')->nullable()->index();
            $table->unsignedBigInteger('plan_id')->nullable()->index();
            $table->string('plan_name')->nullable();
            $table->integer('expired_at')->nullable()->index();
            $table->string('client_type')->nullable()->index();
            $table->string('ip', 45)->nullable()->index();
            $table->string('subscribe_domain')->nullable();
            $table->string('country')->nullable();
            $table->string('region')->nullable();
            $table->string('city')->nullable();
            $table->string('asn')->nullable();
            $table->string('isp')->nullable();
            $table->text('user_agent')->nullable();
            $table->string('ua_hash', 64)->nullable()->index();
            $table->string('status')->nullable()->index();
            $table->string('reason')->nullable();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_subscribe_log');
    }
}
