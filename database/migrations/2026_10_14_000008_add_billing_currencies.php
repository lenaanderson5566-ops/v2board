<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_user','currency')) Schema::table('v2_user',fn(Blueprint $t)=>$t->string('currency',3)->default('CNY'));
        if (!Schema::hasColumn('v2_plan','usd_prices')) Schema::table('v2_plan',fn(Blueprint $t)=>$t->text('usd_prices')->nullable());
        if (!Schema::hasColumn('v2_payment','currency')) Schema::table('v2_payment',fn(Blueprint $t)=>$t->string('currency',3)->default('CNY'));
        if (!Schema::hasColumn('v2_order','fx_snapshot')) Schema::table('v2_order',fn(Blueprint $t)=>$t->text('fx_snapshot')->nullable());
        if (!Schema::hasColumn('v2_commission_log','currency')) Schema::table('v2_commission_log',fn(Blueprint $t)=>$t->string('currency',3)->default('CNY'));
        if (!Schema::hasColumn('v2_commission_log','order_currency')) Schema::table('v2_commission_log',fn(Blueprint $t)=>$t->string('order_currency',3)->default('CNY'));
        if (!Schema::hasTable('v2_exchange_rate')) {
            Schema::create('v2_exchange_rate',function(Blueprint $t){
                $t->unsignedInteger('id')->primary(); $t->unsignedBigInteger('usd_cny_micros')->nullable();
                $t->unsignedInteger('quoted_at')->nullable(); $t->unsignedInteger('fetched_at')->nullable();
                $t->string('automatic_day',10)->nullable(); $t->unsignedInteger('attempted_at')->nullable();
                $t->string('last_error',32)->nullable();
            });
            DB::table('v2_exchange_rate')->insert(['id'=>1]);
        }
    }
    public function down(): void { throw new RuntimeException('Currency records must not be relabelled or discarded.'); }
};
