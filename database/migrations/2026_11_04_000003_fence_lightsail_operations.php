<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('v2_lightsail_server', 'operation_attempt')) {
            Schema::table('v2_lightsail_server', fn (Blueprint $table) => $table->uuid('operation_attempt')->nullable());
        }
    }

    public function down(): void
    {
        Schema::table('v2_lightsail_server', fn (Blueprint $table) => $table->dropColumn('operation_attempt'));
    }
};
