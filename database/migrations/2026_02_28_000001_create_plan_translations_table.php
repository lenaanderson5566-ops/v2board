<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreatePlanTranslationsTable extends Migration
{
    public function up()
    {
        if (Schema::hasTable('v2_plan_translation')) {
            return;
        }

        Schema::create('v2_plan_translation', function (Blueprint $table) {
            $table->increments('id');
            $table->integer('plan_id');
            $table->string('locale', 16);
            $table->string('name', 255)->nullable();
            $table->text('content')->nullable();
            $table->integer('created_at');
            $table->integer('updated_at');
            $table->unique(['plan_id', 'locale'], 'idx_plan_locale_unique');
            $table->index('locale');
            $table->foreign('plan_id')->references('id')->on('v2_plan')->onDelete('cascade');
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_plan_translation');
    }
}
