<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_email_invitation', 'mail_log_id')) Schema::table('v2_email_invitation', function (Blueprint $table) { $table->unsignedInteger('mail_log_id')->nullable(); });
    }
    public function down(): void {
        if (Schema::hasColumn('v2_email_invitation', 'mail_log_id')) Schema::table('v2_email_invitation', function (Blueprint $table) { $table->dropColumn('mail_log_id'); });
    }
};
