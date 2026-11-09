<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    private const EVENT_TABLES = ['v2_payment_attempt_event', 'v2_payment_callback_event'];

    public function up(): void
    {
        foreach (self::EVENT_TABLES as $tableName) {
            if (!Schema::hasColumn($tableName, 'raw_diagnostic')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->longText('raw_diagnostic')->nullable();
                });
            }
        }
    }

    public function down(): void
    {
        foreach (self::EVENT_TABLES as $tableName) {
            if (Schema::hasColumn($tableName, 'raw_diagnostic')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->dropColumn('raw_diagnostic');
                });
            }
        }
    }
};
