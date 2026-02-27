<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateRiskSettingTable extends Migration
{
    public function up()
    {
        Schema::create('v2_risk_setting', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();
            $table->text('value')->nullable();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_risk_setting');
    }
}
