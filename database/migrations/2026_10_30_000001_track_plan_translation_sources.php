<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['name_source_hash' => 64, 'content_source_hash' => 64, 'name_origin' => 16, 'content_origin' => 16] as $column => $length) {
            if (!Schema::hasColumn('v2_plan_translation', $column)) Schema::table('v2_plan_translation', function (Blueprint $table) use ($column, $length) {
                $table->string($column, $length)->nullable();
            });
        }
        // Historical translations remain unverified. Do not fabricate a match to today's source.
    }

    public function down(): void
    {
        throw new RuntimeException('Restore a coordinated backup to preserve translation provenance.');
    }
};
