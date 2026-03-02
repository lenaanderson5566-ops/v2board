<?php

use App\Services\CurrencyRateService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SeedDisplayCurrencySettings extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_currency_setting')) {
            return;
        }

        $currencyRateService = new CurrencyRateService();
        $displayCurrency = strtoupper((string)DB::table('v2_currency_setting')
            ->where('key', 'business_base_currency')
            ->value('value') ?: 'CNY');

        DB::table('v2_currency_setting')->updateOrInsert(
            ['key' => 'display_currency'],
            ['value' => $displayCurrency]
        );
        DB::table('v2_currency_setting')->updateOrInsert(
            ['key' => 'display_currency_symbol'],
            ['value' => $currencyRateService->getDisplayCurrencySymbol($displayCurrency)]
        );
    }

    public function down()
    {
        if (!Schema::hasTable('v2_currency_setting')) {
            return;
        }

        DB::table('v2_currency_setting')->whereIn('key', ['display_currency', 'display_currency_symbol'])->delete();
    }
}
