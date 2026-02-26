<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddTrafficSnapshotToSubscribeLogTable extends Migration
{
    public function up()
    {
        Schema::table('v2_subscribe_log', function (Blueprint $table) {
            $table->unsignedBigInteger('traffic_u')->nullable()->after('client_type');
            $table->unsignedBigInteger('traffic_d')->nullable()->after('traffic_u');
            $table->unsignedBigInteger('traffic_total')->nullable()->after('traffic_d');
        });
    }

    public function down()
    {
        Schema::table('v2_subscribe_log', function (Blueprint $table) {
            $table->dropColumn(['traffic_u', 'traffic_d', 'traffic_total']);
        });
    }
}
