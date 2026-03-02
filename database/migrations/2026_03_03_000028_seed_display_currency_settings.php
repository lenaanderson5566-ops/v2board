<?php

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

        DB::table('v2_currency_setting')->updateOrInsert(
            ['key' => 'display_currency'],
            ['value' => config('v2board.currency', 'CNY')]
        );
        DB::table('v2_currency_setting')->updateOrInsert(
            ['key' => 'display_currency_symbol'],
            ['value' => config('v2board.currency_symbol', '¥')]
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
