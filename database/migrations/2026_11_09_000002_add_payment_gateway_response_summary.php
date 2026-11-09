<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_payment_attempt_event', 'gateway_response')) {
            Schema::table('v2_payment_attempt_event', function (Blueprint $table) {
                $table->json('gateway_response')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('v2_payment_attempt_event', 'gateway_response')) {
            Schema::table('v2_payment_attempt_event', function (Blueprint $table) {
                $table->dropColumn('gateway_response');
            });
        }
    }
};
