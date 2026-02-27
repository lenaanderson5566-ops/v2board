<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class OptimizeUserOnlineSnapshotUniqueIndex extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user_online_snapshot')) {
            return;
        }

        DB::statement("DELETE t1 FROM v2_user_online_snapshot t1 INNER JOIN v2_user_online_snapshot t2 ON t1.user_id = t2.user_id AND t1.source = t2.source AND t1.id < t2.id");

        Schema::table('v2_user_online_snapshot', function (Blueprint $table) {
            $table->dropUnique('v2_user_online_snapshot_unique');
            $table->unique(['user_id', 'source'], 'v2_user_online_snapshot_user_source_unique');
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_user_online_snapshot')) {
            return;
        }

        Schema::table('v2_user_online_snapshot', function (Blueprint $table) {
            $table->dropUnique('v2_user_online_snapshot_user_source_unique');
            $table->unique(['user_id', 'ip', 'node', 'source'], 'v2_user_online_snapshot_unique');
        });
    }
}
