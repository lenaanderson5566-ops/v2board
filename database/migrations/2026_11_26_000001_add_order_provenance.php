<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        $needsSource = !Schema::hasColumn('v2_order', 'order_source');
        $needsEvidence = !Schema::hasColumn('v2_order', 'manual_payment_evidence');
        if ($needsSource || $needsEvidence) {
            Schema::table('v2_order', function (Blueprint $table) use ($needsSource, $needsEvidence) {
                if ($needsSource) $table->string('order_source', 16)->nullable();
                if ($needsEvidence) $table->json('manual_payment_evidence')->nullable();
            });
        }
    }

    public function down(): void
    {
        // Preserve provenance and receipt evidence when rolling application code back.
    }
};
