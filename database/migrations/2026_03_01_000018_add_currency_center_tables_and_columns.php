<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AddCurrencyCenterTablesAndColumns extends Migration
{
    public function up()
    {

        if (!Schema::hasTable('v2_currency_setting')) {
            Schema::create('v2_currency_setting', function (Blueprint $table) {
                $table->increments('id');
                $table->string('key', 64)->unique();
                $table->text('value')->nullable();
                $table->integer('created_at')->nullable();
                $table->integer('updated_at')->nullable();
            });
        }

        DB::table('v2_currency_setting')->updateOrInsert(['key' => 'business_base_currency'], ['value' => 'CNY']);
        DB::table('v2_currency_setting')->updateOrInsert(['key' => 'currency_rate_api'], ['value' => 'https://open.er-api.com/v6/latest/{base}']);

        if (!Schema::hasTable('v2_currency_rate')) {
            Schema::create('v2_currency_rate', function (Blueprint $table) {
                $table->increments('id');
                $table->string('base_currency', 8);
                $table->string('quote_currency', 8);
                $table->decimal('rate_to_base', 18, 8)->comment('1 quote = ? base');
                $table->decimal('rate_to_cny', 18, 8)->comment('1 quote = ? CNY');
                $table->integer('fetched_at');
                $table->integer('created_at');
                $table->integer('updated_at');
                $table->unique(['base_currency', 'quote_currency'], 'uniq_base_quote');
            });
        }

        Schema::table('v2_payment', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_payment', 'currency')) {
                $table->string('currency', 8)->default('CNY')->after('name')->comment('网关支付币种');
            }
        });

        Schema::table('v2_order', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_order', 'pricing_currency')) {
                $table->string('pricing_currency', 8)->default('CNY')->after('total_amount')->comment('订单计价币种');
            }
            if (!Schema::hasColumn('v2_order', 'payment_currency')) {
                $table->string('payment_currency', 8)->nullable()->after('pricing_currency')->comment('实际支付币种');
            }
            if (!Schema::hasColumn('v2_order', 'payment_amount')) {
                $table->integer('payment_amount')->nullable()->after('payment_currency')->comment('锁定支付金额(最小货币单位)');
            }
            if (!Schema::hasColumn('v2_order', 'exchange_rate')) {
                $table->decimal('exchange_rate', 18, 8)->nullable()->after('payment_amount')->comment('锁定汇率: 1支付币种=?CNY');
            }
            if (!Schema::hasColumn('v2_order', 'exchange_rate_at')) {
                $table->integer('exchange_rate_at')->nullable()->after('exchange_rate')->comment('锁定汇率时间');
            }
        });

        DB::table('v2_order')
            ->whereNull('pricing_currency')
            ->update(['pricing_currency' => 'CNY']);
    }

    public function down()
    {
        Schema::table('v2_order', function (Blueprint $table) {
            foreach (['pricing_currency', 'payment_currency', 'payment_amount', 'exchange_rate', 'exchange_rate_at'] as $column) {
                if (Schema::hasColumn('v2_order', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('v2_payment', function (Blueprint $table) {
            if (Schema::hasColumn('v2_payment', 'currency')) {
                $table->dropColumn('currency');
            }
        });

        Schema::dropIfExists('v2_currency_rate');
        Schema::dropIfExists('v2_currency_setting');
    }
}
