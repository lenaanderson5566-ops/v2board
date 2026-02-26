<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateRiskBlacklistTable extends Migration
{
    public function up()
    {
        Schema::create('v2_risk_blacklist', function (Blueprint $table) {
            $table->id();
            $table->string('type', 32)->index(); // ip | ua_hash
            $table->string('value', 255)->index();
            $table->string('remark')->nullable();
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();

            $table->unique(['type', 'value']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_risk_blacklist');
    }
}
