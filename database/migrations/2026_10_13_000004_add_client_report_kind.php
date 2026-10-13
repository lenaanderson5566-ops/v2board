<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_client_diagnostic_report','report_kind')) {
            Schema::table('v2_client_diagnostic_report', function (Blueprint $t) {
                $t->string('report_kind',16)->default('diagnostic')->index();
            });
        }
    }
    public function down(): void {
        Schema::table('v2_client_diagnostic_report', function (Blueprint $t) { $t->dropColumn('report_kind'); });
    }
};
