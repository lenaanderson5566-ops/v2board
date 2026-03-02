<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddCommissionCurrencyToUser extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        Schema::table('v2_user', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_user', 'commission_currency')) {
                $table->string('commission_currency', 8)->default('CNY')->after('commission_balance');
            }
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_user')) {
            return;
        }

        Schema::table('v2_user', function (Blueprint $table) {
            if (Schema::hasColumn('v2_user', 'commission_currency')) {
                $table->dropColumn('commission_currency');
            }
        });
    }
}
