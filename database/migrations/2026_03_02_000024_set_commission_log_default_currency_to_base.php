<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SetCommissionLogDefaultCurrencyToBase extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_commission_log') || !Schema::hasTable('v2_currency_setting')) {
            return;
        }

        $baseCurrency = strtoupper((string)DB::table('v2_currency_setting')
            ->where('key', 'business_base_currency')
            ->value('value'));
        if (!$baseCurrency) {
            $baseCurrency = 'CNY';
        }

        DB::statement("ALTER TABLE v2_commission_log MODIFY COLUMN get_currency VARCHAR(8) NOT NULL DEFAULT '{$baseCurrency}'");
    }

    public function down()
    {
        if (!Schema::hasTable('v2_commission_log')) {
            return;
        }

        DB::statement("ALTER TABLE v2_commission_log MODIFY COLUMN get_currency VARCHAR(8) NOT NULL DEFAULT 'CNY'");
    }
}
