<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    private const TABLE = 'v2_usage_reset_log';
    private const INDEX = 'usage_reset_kind_created_id';

    public function up(): void
    {
        if (!Schema::hasIndex(self::TABLE, self::INDEX)) {
            Schema::table(self::TABLE, fn (Blueprint $table) =>
                $table->index(['kind', 'created_at', 'id'], self::INDEX)->inplace()->lock('none'));
        }
    }

    public function down(): void
    {
        if (Schema::hasIndex(self::TABLE, self::INDEX)) {
            Schema::table(self::TABLE, fn (Blueprint $table) => $table->dropIndex(self::INDEX));
        }
    }
};
