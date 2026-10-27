<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_server_route', 'backend')) Schema::table('v2_server_route', function (Blueprint $table) {
            // Classify pre-separation rules before copying those referenced by V2Box.
            // Retirement later removes unreferenced legacy rules and changes the default.
            $table->string('backend', 16)->default('v2node')->index();
            $table->mediumText('sing_box')->nullable();
        });
        DB::transaction(function () {
            $copies = [];
            foreach (DB::table('v2_server_v2box')->orderBy('id')->get() as $node) {
                $ids = [];
                $native = json_decode($node->sing_box ?? 'null', true);
                if ($native) {
                    $ids[] = DB::table('v2_server_route')->insertGetId([
                        'backend'=>'v2box', 'remarks'=>mb_substr($node->name.' / sing-box', 0, 255),
                        'match'=>'[]', 'action'=>'sing_box', 'sing_box'=>json_encode($native),
                        'created_at'=>time(), 'updated_at'=>time(),
                    ]);
                } else {
                    foreach (json_decode($node->route_id ?? '[]', true) ?? [] as $id) {
                        $route = DB::table('v2_server_route')->find($id);
                        if (!$route) continue;
                        if ($route->backend === 'v2box') { $ids[] = (int)$id; continue; }
                        if (!isset($copies[$id])) {
                            $copy = (array)$route;
                            unset($copy['id']);
                            $copy['backend'] = 'v2box';
                            $copies[$id] = DB::table('v2_server_route')->insertGetId($copy);
                        }
                        $ids[] = $copies[$id];
                    }
                }
                DB::table('v2_server_v2box')->where('id', $node->id)->update(['route_id'=>json_encode($ids), 'sing_box'=>null]);
            }
        });
    }
    public function down(): void {
        // Catalog IDs and independent copies cannot be safely folded back into shared rules.
        throw new \RuntimeException('Restore a database backup to roll back independent node routing.');
    }
};
