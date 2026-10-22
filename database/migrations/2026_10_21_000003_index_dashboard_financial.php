<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    private const INDEXES=[
        ['v2_order','order_paid_currency',['paid_at','status','currency']],
        ['v2_order','order_pending_commission',['commission_status','commission_balance']],
        ['v2_commission_log','commission_created_currency',['created_at','currency']],
    ];
    public function up(): void {
        foreach(self::INDEXES as [$table,$name,$columns]) if(!Schema::hasIndex($table,$name))Schema::table($table,fn(Blueprint $t)=>$t->index($columns,$name));
    }
    public function down(): void {
        foreach(self::INDEXES as [$table,$name]) if(Schema::hasIndex($table,$name))Schema::table($table,fn(Blueprint $t)=>$t->dropIndex($name));
    }
};
