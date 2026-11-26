<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('v2_order', 'order_source')) {
            Schema::table('v2_order', function (Blueprint $table) {
                $table->dropColumn('order_source');
            });
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Retired order source history can only be recovered from a database backup.');
    }
};
