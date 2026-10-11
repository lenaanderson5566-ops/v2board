<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_order', 'payment_snapshot')) Schema::table('v2_order', function (Blueprint $table) { $table->json('payment_snapshot')->nullable(); });
    }
    public function down(): void {
        Schema::table('v2_order', function (Blueprint $table) { $table->dropColumn('payment_snapshot'); });
    }
};
