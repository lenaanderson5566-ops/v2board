<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SplitRiskBlacklistTables extends Migration
{
    public function up()
    {
        Schema::create('v2_risk_blacklist_ip', function (Blueprint $table) {
            $table->id();
            $table->string('value', 45)->unique();
            $table->string('remark')->nullable();
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });

        Schema::create('v2_risk_blacklist_ua_hash', function (Blueprint $table) {
            $table->id();
            $table->string('value', 64)->unique();
            $table->string('remark')->nullable();
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });

        if (Schema::hasTable('v2_risk_blacklist')) {
            $now = time();
            $ips = DB::table('v2_risk_blacklist')->where('type', 'ip')->get();
            foreach ($ips as $row) {
                DB::table('v2_risk_blacklist_ip')->updateOrInsert(
                    ['value' => $row->value],
                    ['remark' => $row->remark, 'is_enabled' => (int) $row->is_enabled, 'created_at' => $row->created_at ?: $now, 'updated_at' => $row->updated_at ?: $now]
                );
            }

            $uas = DB::table('v2_risk_blacklist')->where('type', 'ua_hash')->get();
            foreach ($uas as $row) {
                DB::table('v2_risk_blacklist_ua_hash')->updateOrInsert(
                    ['value' => strtolower($row->value)],
                    ['remark' => $row->remark, 'is_enabled' => (int) $row->is_enabled, 'created_at' => $row->created_at ?: $now, 'updated_at' => $row->updated_at ?: $now]
                );
            }
        }
    }

    public function down()
    {
        Schema::dropIfExists('v2_risk_blacklist_ua_hash');
        Schema::dropIfExists('v2_risk_blacklist_ip');
    }
}
