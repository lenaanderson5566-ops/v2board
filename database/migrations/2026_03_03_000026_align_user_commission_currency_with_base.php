<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AlignUserCommissionCurrencyWithBase extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user') || !Schema::hasColumn('v2_user', 'commission_currency')) {
            return;
        }

        $baseCurrency = 'CNY';
        if (Schema::hasTable('v2_currency_setting')) {
            $baseCurrency = strtoupper((string)DB::table('v2_currency_setting')
                ->where('key', 'business_base_currency')
                ->value('value'));
            if (!$baseCurrency) {
                $baseCurrency = 'CNY';
            }
        }

        DB::table('v2_user')
            ->where(function ($query) {
                $query->whereNull('commission_currency')
                    ->orWhere('commission_currency', '')
                    ->orWhereRaw('UPPER(commission_currency) = ?', ['CNY']);
            })
            ->update(['commission_currency' => $baseCurrency]);

        DB::statement("ALTER TABLE v2_user MODIFY COLUMN commission_currency VARCHAR(8) NOT NULL DEFAULT '{$baseCurrency}'");
    }

    public function down()
    {
        if (!Schema::hasTable('v2_user') || !Schema::hasColumn('v2_user', 'commission_currency')) {
            return;
        }

        DB::statement("ALTER TABLE v2_user MODIFY COLUMN commission_currency VARCHAR(8) NOT NULL DEFAULT 'CNY'");
    }
}
