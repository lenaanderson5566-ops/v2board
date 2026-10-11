<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_server_v2box')) {
            DB::statement('CREATE TABLE `v2_server_v2box` LIKE `v2_server_v2node`');
        }
    }
    public function down(): void { Schema::dropIfExists('v2_server_v2box'); }
};
