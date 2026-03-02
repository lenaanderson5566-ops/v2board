<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class BackfillCnyWalletFromUserBalance extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user_wallet') || !Schema::hasTable('v2_user')) {
            return;
        }

        $users = DB::table('v2_user')->select(['id', 'balance'])->get();
        foreach ($users as $user) {
            DB::table('v2_user_wallet')->updateOrInsert(
                ['user_id' => $user->id, 'currency' => 'CNY'],
                ['balance' => (int)$user->balance, 'updated_at' => time(), 'created_at' => time()]
            );
        }
    }

    public function down()
    {
        // keep wallet data
    }
}
