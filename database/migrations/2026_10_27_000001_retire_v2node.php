<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    // Remove only retired operational configuration. Shared accounting history remains intact.
    public const REFERENCES = [
        'v2_node_credential' => 'node_type',
        'v2_node_credential_state' => 'node_type',
        'v2_node_ddns' => 'node_type',
        'v2_node_connection' => 'node_type',
        'v2_node_maintenance' => 'type',
        'v2_server_traffic_binding' => 'node_type',
        'v2_server_traffic_import' => 'node_type',
        'v2_lightsail_server' => 'node_type',
        'v2_server_route' => 'backend',
    ];

    public function up(): void {
        DB::transaction(function () {
            foreach (self::REFERENCES as $table => $column) {
                if (Schema::hasTable($table) && Schema::hasColumn($table, $column)) {
                    DB::table($table)->where($column, 'v2node')->delete();
                }
            }
        });
        // MySQL DDL commits independently; both steps are safe to retry after interruption.
        Schema::dropIfExists('v2_server_v2node');
        if (Schema::hasColumn('v2_server_route', 'backend')) {
            Schema::table('v2_server_route', function (Blueprint $table) {
                $table->string('backend', 16)->default('v2box')->change();
            });
        }
    }

    public function down(): void {
        throw new LogicException('Restore a coordinated backup to recover retired V2Node configuration.');
    }
};
