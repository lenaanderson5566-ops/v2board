<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_coupon', 'public_claim')) Schema::table('v2_coupon', function(Blueprint $t) {
            $t->boolean('public_claim')->default(false);
        });
        if (!Schema::hasTable('v2_coupon_wallet')) Schema::create('v2_coupon_wallet', function(Blueprint $t) {
            $t->bigIncrements('id');
            $t->unsignedInteger('user_id');
            $t->unsignedInteger('coupon_id');
            $t->text('snapshot');
            $t->unsignedInteger('order_id')->nullable()->unique();
            $t->unsignedInteger('administrator_id')->nullable();
            $t->unsignedInteger('created_at');
            $t->unique(['user_id', 'coupon_id']);
        });
    }
    public function down(): void { throw new RuntimeException('Preserve issued coupons.'); }
};
