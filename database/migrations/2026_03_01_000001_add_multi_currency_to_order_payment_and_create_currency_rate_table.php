<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

class AddMultiCurrencyToOrderPaymentAndCreateCurrencyRateTable extends Migration
{
    public function up()
    {
        Schema::create('v2_currency_rate', function (Blueprint $table) {
            $table->increments('id');
            $table->string('base_currency', 8);
            $table->string('quote_currency', 8);
            $table->decimal('rate', 18, 8);
            $table->string('source', 64)->nullable();
            $table->integer('fetched_at');
            $table->integer('created_at');
            $table->integer('updated_at');
            $table->index(['base_currency', 'quote_currency']);
            $table->index('fetched_at');
        });

        Schema::table('v2_payment', function (Blueprint $table) {
            $table->string('currency', 8)->nullable()->after('name');
        });

        Schema::table('v2_order', function (Blueprint $table) {
            $table->string('pricing_currency', 8)->default('CNY')->after('period');
            $table->integer('pricing_amount')->nullable()->after('total_amount');
            $table->decimal('pricing_to_cny_rate', 18, 8)->default(1)->after('pricing_amount');
            $table->string('payment_currency', 8)->nullable()->after('payment_id');
            $table->integer('payment_amount')->nullable()->after('handling_amount');
            $table->decimal('pricing_to_payment_rate', 18, 8)->nullable()->after('pricing_to_cny_rate');
            $table->integer('rate_locked_at')->nullable()->after('paid_at');
        });

        DB::table('v2_order')->update([
            'pricing_currency' => 'CNY',
            'pricing_amount' => DB::raw('total_amount'),
            'pricing_to_cny_rate' => 1,
            'payment_currency' => 'CNY',
            'payment_amount' => DB::raw('total_amount'),
            'pricing_to_payment_rate' => 1
        ]);
    }

    public function down()
    {
        Schema::table('v2_order', function (Blueprint $table) {
            $table->dropColumn([
                'pricing_currency',
                'pricing_amount',
                'pricing_to_cny_rate',
                'payment_currency',
                'payment_amount',
                'pricing_to_payment_rate',
                'rate_locked_at'
            ]);
        });

        Schema::table('v2_payment', function (Blueprint $table) {
            $table->dropColumn('currency');
        });

        Schema::dropIfExists('v2_currency_rate');
    }
}
