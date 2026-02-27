<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateClientStrategyTable extends Migration
{
    public function up()
    {
        Schema::create('v2_client_strategy', function (Blueprint $table) {
            $table->id();
            $table->string('client_type')->unique();
            $table->string('client_name');
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('sort')->default(0)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();

            $table->index(['is_enabled', 'sort']);
        });
    }

    public function down()
    {
        Schema::dropIfExists('v2_client_strategy');
    }
}
