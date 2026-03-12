<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddDiscountSplitFieldsToOrderTable extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_order')) {
            return;
        }

        Schema::table('v2_order', function (Blueprint $table) {
            if (!Schema::hasColumn('v2_order', 'coupon_discount_amount')) {
                $table->integer('coupon_discount_amount')->nullable()->after('discount_amount')->comment('优惠券折扣金额');
            }
            if (!Schema::hasColumn('v2_order', 'user_discount_amount')) {
                $table->integer('user_discount_amount')->nullable()->after('coupon_discount_amount')->comment('个人专享折扣金额');
            }
        });
    }

    public function down()
    {
        if (!Schema::hasTable('v2_order')) {
            return;
        }

        Schema::table('v2_order', function (Blueprint $table) {
            if (Schema::hasColumn('v2_order', 'user_discount_amount')) {
                $table->dropColumn('user_discount_amount');
            }
            if (Schema::hasColumn('v2_order', 'coupon_discount_amount')) {
                $table->dropColumn('coupon_discount_amount');
            }
        });
    }
}
