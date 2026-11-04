<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('v2_mail_event') || !Schema::hasTable('v2_mail_suppression')) return;

        $complaints = DB::table('v2_mail_event')->select('recipient_hash')
            ->where('state', 'complained')->whereNotNull('applied_at');
        DB::table('v2_mail_suppression')->where('reason', 'bounced')
            ->whereIn('recipient_hash', $complaints)
            ->update(['reason' => 'complained', 'released_at' => null, 'updated_at' => time()]);
    }

    public function down(): void
    {
        throw new RuntimeException('Restore a coordinated backup for mail suppression rollback.');
    }
};
