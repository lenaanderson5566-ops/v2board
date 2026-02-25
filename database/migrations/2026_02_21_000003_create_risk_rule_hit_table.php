<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateRiskRuleHitTable extends Migration
{
    public function up()
    {
        Schema::create('v2_risk_rule_hit', function (Blueprint $table) {
            $table->id();
            $table->string('scene')->index();
            $table->string('rule_key')->index();
            $table->string('risk_level')->nullable()->index();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->string('email')->nullable()->index();
            $table->string('ip', 45)->nullable()->index();
            $table->string('client_type')->nullable()->index();
            $table->string('status')->nullable()->index();
            $table->string('reason')->nullable();
            $table->json('payload')->nullable();
            $table->integer('hit_at')->nullable()->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_risk_rule_hit');
    }
}
