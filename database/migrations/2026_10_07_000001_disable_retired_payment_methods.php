<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

class DisableRetiredPaymentMethods extends Migration
{
    public function up()
    {
        DB::table('v2_payment')->whereIn('payment', ['Epusdt', 'BEasyPaymentUSDT'])->update(['enable'=>0]);
    }

    public function down()
    {
        // Removed gateways must never be automatically re-enabled on rollback.
    }
}
