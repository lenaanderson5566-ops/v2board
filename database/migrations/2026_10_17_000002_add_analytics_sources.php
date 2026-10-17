<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('v2_analytics_session', function (Blueprint $table) {
            $table->unsignedTinyInteger('attribution_version')->default(0);
            $table->string('source_domain', 253)->nullable();
        });
    }
    public function down(): void {
        Schema::table('v2_analytics_session', function (Blueprint $table) {
            $table->dropColumn(['attribution_version','source_domain']);
        });
    }
};
