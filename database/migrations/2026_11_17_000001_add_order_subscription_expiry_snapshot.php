<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_order', 'previous_subscription_expires_at')) {
            Schema::table('v2_order', function (Blueprint $table) {
                $table->unsignedBigInteger('previous_subscription_expires_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('v2_order', 'previous_subscription_expires_at')) {
            Schema::table('v2_order', function (Blueprint $table) {
                $table->dropColumn('previous_subscription_expires_at');
            });
        }
    }
};
