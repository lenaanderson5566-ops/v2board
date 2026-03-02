<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class DropRateToCnyFromCurrencyRate extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_currency_rate')) {
            return;
        }

        Schema::table('v2_currency_rate', function (Blueprint $table) {
            if (Schema::hasColumn('v2_currency_rate', 'rate_to_cny')) {
                $table->dropColumn('rate_to_cny');
            }
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_currency_rate')) {
            return;
        }

        Schema::table('v2_currency_rate', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_currency_rate', 'rate_to_cny')) {
                $table->decimal('rate_to_cny', 18, 8)->nullable()->after('rate_to_base');
            }
        });
    }
}
