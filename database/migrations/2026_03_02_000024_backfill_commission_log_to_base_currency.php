<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class BackfillCommissionLogToBaseCurrency extends Migration
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

        // keep schema default consistent with current business base currency
        DB::statement("ALTER TABLE v2_commission_log MODIFY COLUMN get_currency VARCHAR(8) NOT NULL DEFAULT '{$baseCurrency}'");

        if ($baseCurrency === 'CNY') {
            DB::table('v2_commission_log')
                ->where(function ($query) {
                    $query->whereNull('get_currency')
                        ->orWhere('get_currency', '')
                        ->orWhere('get_currency', 'CNY');
                })
                ->update(['get_currency' => 'CNY']);
            return;
        }

        if (!Schema::hasTable('v2_currency_rate')) {
            return;
        }

        $rateToCny = (float)DB::table('v2_currency_rate')
            ->where('quote_currency', $baseCurrency)
            ->orderByDesc('fetched_at')
            ->value('rate_to_cny');

        if ($rateToCny <= 0) {
            return;
        }

        DB::statement("\n            UPDATE v2_commission_log\n            SET get_amount = GREATEST(1, ROUND(get_amount / {$rateToCny})),\n                get_currency = '{$baseCurrency}'\n            WHERE get_amount > 0\n              AND (get_currency IS NULL OR get_currency = '' OR get_currency = 'CNY')\n        ");
    }

    public function down()
    {
        if (!Schema::hasTable('v2_commission_log')) {
            return;
        }

        DB::statement("ALTER TABLE v2_commission_log MODIFY COLUMN get_currency VARCHAR(8) NOT NULL DEFAULT 'CNY'");
    }
}
