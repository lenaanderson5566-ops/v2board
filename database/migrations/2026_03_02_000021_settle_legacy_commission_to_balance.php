<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SettleLegacyCommissionToBalance extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        if (!Schema::hasColumn('v2_user', 'commission_balance')) {
            return;
        }

        $now = time();

        if (Schema::hasTable('v2_user_wallet')) {
            DB::statement("\n                INSERT INTO v2_user_wallet (user_id, currency, balance, created_at, updated_at)\n                SELECT u.id, 'CNY', 0, {$now}, {$now}\n                FROM v2_user u\n                LEFT JOIN v2_user_wallet w ON w.user_id = u.id AND w.currency = 'CNY'\n                WHERE w.id IS NULL\n            ");

            DB::statement("\n                UPDATE v2_user_wallet w\n                INNER JOIN v2_user u ON u.id = w.user_id\n                SET w.balance = w.balance + u.commission_balance,\n                    w.updated_at = {$now}\n                WHERE w.currency = 'CNY' AND u.commission_balance > 0\n            ");
        }

        DB::statement("\n            UPDATE v2_user\n            SET balance = balance + commission_balance,\n                commission_balance = 0\n            WHERE commission_balance > 0\n        ");
    }

    public function down()
    {
        // Irreversible data migration.
    }
}
