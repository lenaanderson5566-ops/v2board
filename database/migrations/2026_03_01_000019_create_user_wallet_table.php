<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateUserWalletTable extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('v2_user_wallet')) {
            Schema::create('v2_user_wallet', function (Blueprint $table) {
                $table->increments('id');
                $table->integer('user_id')->index();
                $table->string('currency', 8)->default('CNY');
                $table->integer('balance')->default(0)->comment('最小货币单位余额');
                $table->integer('created_at');
                $table->integer('updated_at');
                $table->unique(['user_id', 'currency'], 'uniq_user_currency');
            });
        }
    }

    public function down()
    {
        Schema::dropIfExists('v2_user_wallet');
    }
}
