<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    private const SESSION_COLUMNS = ['browser', 'browser_major', 'os', 'embedded', 'language'];
    private const EVENTS = ['download', 'copy_success', 'import_start', 'help_open', 'guide_manual', 'guide_continue', 'payment_open'];

    public function up(): void
    {
        if (Schema::hasTable('v2_analytics_measurement')) {
            DB::table('v2_analytics_measurement')->select('id')->whereIn('event', self::EVENTS)
                ->chunkById(1000, function ($rows) {
                    DB::table('v2_analytics_measurement')->whereIn('id', $rows->pluck('id'))->delete();
                });
        }

        if (Schema::hasTable('v2_analytics_session')) {
            $columns = array_values(array_intersect(self::SESSION_COLUMNS, Schema::getColumnListing('v2_analytics_session')));
            if ($columns) {
                Schema::table('v2_analytics_session', fn (Blueprint $table) => $table->dropColumn($columns));
            }
        }

        Schema::dropIfExists('v2_analytics_page');
    }

    public function down(): void
    {
        throw new RuntimeException('Retired dashboard telemetry cannot be recovered; restore a database backup to roll back.');
    }
};
