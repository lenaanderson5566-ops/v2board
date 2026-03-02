<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddCurrencyColumnsToCommissionLog extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_commission_log')) {
            return;
        }

        Schema::table('v2_commission_log', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_commission_log', 'order_currency')) {
                $table->string('order_currency', 8)->default('CNY')->after('order_amount');
            }
            if (!Schema::hasColumn('v2_commission_log', 'get_currency')) {
                $table->string('get_currency', 8)->default('CNY')->after('get_amount');
            }
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_commission_log')) {
            return;
        }

        Schema::table('v2_commission_log', function (Blueprint $table) {
            if (Schema::hasColumn('v2_commission_log', 'order_currency')) {
                $table->dropColumn('order_currency');
            }
            if (Schema::hasColumn('v2_commission_log', 'get_currency')) {
                $table->dropColumn('get_currency');
            }
        });
    }
}
