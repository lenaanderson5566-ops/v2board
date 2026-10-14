<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_mail_log', 'transport_code')) Schema::table('v2_mail_log', fn(Blueprint $t) => $t->unsignedSmallInteger('transport_code')->nullable());
        if (!Schema::hasColumn('v2_mail_log', 'enhanced_code')) Schema::table('v2_mail_log', fn(Blueprint $t) => $t->string('enhanced_code', 11)->nullable());
        if (!Schema::hasColumn('v2_mail_log', 'user_id')) Schema::table('v2_mail_log', fn(Blueprint $t) => $t->unsignedBigInteger('user_id')->nullable()->index());
    }
    public function down(): void { throw new \RuntimeException('Restore a coordinated backup to roll back mail transport metadata.'); }
};
