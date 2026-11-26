<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_order', 'manual_payment_evidence')) {
            Schema::table('v2_order', function (Blueprint $table) {
                $table->json('manual_payment_evidence')->nullable();
            });
        }
    }

    public function down(): void
    {
        // Preserve receipt evidence when rolling application code back.
    }
};
