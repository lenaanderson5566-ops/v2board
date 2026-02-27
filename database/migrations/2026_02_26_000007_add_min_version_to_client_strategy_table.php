<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddMinVersionToClientStrategyTable extends Migration
{
    public function up()
    {
        Schema::table('v2_client_strategy', function (Blueprint $table) {
            $table->string('min_version')->nullable()->after('client_name')->index();
        });
    }

    public function down()
    {
        Schema::table('v2_client_strategy', function (Blueprint $table) {
            $table->dropColumn('min_version');
        });
    }
}
