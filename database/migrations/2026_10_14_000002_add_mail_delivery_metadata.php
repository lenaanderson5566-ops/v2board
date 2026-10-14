<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        foreach (['provider'=>24, 'status'=>24, 'error_code'=>64, 'message_id'=>255, 'recipient_hash'=>64] as $name=>$length) {
            if (!Schema::hasColumn('v2_mail_log', $name)) Schema::table('v2_mail_log', function (Blueprint $t) use ($name, $length) {
                $column = $t->string($name, $length)->nullable();
                if ($name === 'recipient_hash') $column->index();
            });
        }
        if (!Schema::hasColumn('v2_mail_log', 'duration_ms')) Schema::table('v2_mail_log', function (Blueprint $t) {
            $t->unsignedInteger('duration_ms')->nullable();
            $t->index(['created_at', 'id'], 'mail_delivery_created_id');
        });
    }
    public function down(): void { throw new \RuntimeException('Restore a coordinated backup to roll back mail delivery metadata.'); }
};
