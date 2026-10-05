<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_order','currency')) Schema::table('v2_order', function (Blueprint $t) {
            // All historical amounts are CNY minor units; never convert their values.
            $t->char('currency',3)->default('CNY');
        });
    }
    public function down(): void { throw new RuntimeException('Order currency must be preserved with financial history.'); }
};
