<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class MigrateBalanceToWalletAndDropColumn extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        if (!Schema::hasColumn('v2_user', 'balance')) {
            return;
        }

        if (Schema::hasTable('v2_user_wallet')) {
            $now = time();

            DB::statement("\n                INSERT INTO v2_user_wallet (user_id, currency, balance, created_at, updated_at)\n                SELECT u.id, 'CNY', u.balance, {$now}, {$now}\n                FROM v2_user u\n                LEFT JOIN v2_user_wallet w ON w.user_id = u.id AND w.currency = 'CNY'\n                WHERE w.id IS NULL\n            ");

            DB::statement("\n                UPDATE v2_user_wallet w\n                INNER JOIN v2_user u ON u.id = w.user_id\n                SET w.balance = CASE WHEN w.balance > u.balance THEN w.balance ELSE u.balance END,\n                    w.updated_at = {$now}\n                WHERE w.currency = 'CNY'\n            ");
        }

        Schema::table('v2_user', function (Blueprint $table) {
            $table->dropColumn('balance');
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }
        if (Schema::hasColumn('v2_user', 'balance')) {
            return;
        }

        Schema::table('v2_user', function (Blueprint $table) {
            $table->integer('balance')->default(0)->after('password');
        });
    }
}
