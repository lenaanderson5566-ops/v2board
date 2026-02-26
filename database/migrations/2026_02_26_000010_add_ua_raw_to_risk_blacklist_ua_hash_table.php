<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddUaRawToRiskBlacklistUaHashTable extends Migration
{
    public function up()
    {
        Schema::table('v2_risk_blacklist_ua_hash', function (Blueprint $table) {
            $table->text('ua_raw')->nullable()->after('value');
        });
    }

    public function down()
    {
        Schema::table('v2_risk_blacklist_ua_hash', function (Blueprint $table) {
            $table->dropColumn('ua_raw');
        });
    }
}
