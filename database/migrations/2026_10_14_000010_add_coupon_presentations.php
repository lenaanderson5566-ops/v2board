<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_coupon','activity_title')) Schema::table('v2_coupon',fn(Blueprint $t)=>$t->string('activity_title',120)->nullable());
        if (!Schema::hasColumn('v2_coupon','activity_description')) Schema::table('v2_coupon',fn(Blueprint $t)=>$t->text('activity_description')->nullable());
        if (!Schema::hasColumn('v2_coupon','translations')) Schema::table('v2_coupon',fn(Blueprint $t)=>$t->text('translations')->nullable());
    }
    public function down(): void { throw new RuntimeException('Preserve coupon translations.'); }
};
