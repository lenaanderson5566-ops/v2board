<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function assertReady(): void
    {
        if (!Schema::hasTable('v2_risk_cleanup_task')) {
            return;
        }

        $unfinished = DB::table('v2_risk_cleanup_task')
            ->whereNotIn('state', ['preview', 'superseded', 'completed'])
            ->orderBy('id')->first(['id', 'state']);
        if ($unfinished) {
            throw new RuntimeException(
                "Risk cleanup task #{$unfinished->id} is {$unfinished->state}. "
                ."Finish confirmed tasks on the previous version, retry failed tasks in the cleanup dialog, then rerun the updater."
            );
        }
    }

    public function up(): void
    {
        $this->assertReady();
        Schema::dropIfExists('v2_risk_cleanup_item');
        Schema::dropIfExists('v2_risk_cleanup_task');
    }

    public function down(): void
    {
        throw new RuntimeException('Retired cleanup task history can only be recovered from a matching database backup.');
    }
};
