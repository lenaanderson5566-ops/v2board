<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::statement("ALTER TABLE `v2_order` MODIFY `type` int(11) NOT NULL COMMENT '1新购2续费3升级4重置5降级9充值'");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE `v2_order` MODIFY `type` int(11) NOT NULL COMMENT '1新购2续费3升级'");
    }
};
