<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_server_v2box', 'sing_box')) Schema::table('v2_server_v2box', function (Blueprint $table) { $table->text('sing_box')->nullable(); });
    }
    public function down(): void { Schema::table('v2_server_v2box', function (Blueprint $table) { $table->dropColumn('sing_box'); }); }
};
