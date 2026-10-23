<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class NetworkServers extends Migration {
    public function up() {
        if (!Schema::hasTable('v2_network_server')) Schema::create('v2_network_server', function(Blueprint $t) {
            $t->increments('id'); $t->string('name',100); $t->string('family',8); $t->boolean('enabled')->default(true);
            $t->string('report_hash',64)->nullable()->unique(); $t->text('report_secret')->nullable();
            foreach (['ipv4','ipv6'] as $f) { $t->string($f,45)->nullable(); $t->bigInteger($f.'_seen_at')->default(0); }
        });
        if (!Schema::hasColumn('v2_node_ddns','server_id')) Schema::table('v2_node_ddns',function(Blueprint $t) {
            $t->unsignedInteger('server_id')->nullable()->index();
            $t->unsignedInteger('entry_id')->nullable()->index(); $t->unsignedSmallInteger('entry_port')->nullable();
            $t->string('purpose',10)->default('node');
            $t->bigInteger('relay_verified_at')->default(0);
        });
        if (!Schema::hasColumn('v2_node_ddns','published_origin')) Schema::table('v2_node_ddns',function(Blueprint $t) { $t->string('published_origin',253)->nullable()->index(); $t->unsignedSmallInteger('published_port')->nullable(); });
        // Independent entry domains use node_type=entry, node_id=their own id.
        // Retain existing constraints and never infer shared ownership from matching IPs.
        DB::table('v2_node_ddns')->whereNull('server_id')->orderBy('id')->chunkById(200,function($rows) {
            foreach($rows as $a) DB::transaction(function()use($a) {
                $data=['name'=>$a->node_type.' #'.$a->node_id,'family'=>$a->family,'enabled'=>$a->enabled,'report_hash'=>$a->report_hash];
                foreach(['ipv4','ipv6'] as $f) { $data[$f]=$a->$f; $data[$f.'_seen_at']=$a->{$f.'_seen_at'}; }
                $id=DB::table('v2_network_server')->insertGetId($data);
                DB::table('v2_node_ddns')->where('id',$a->id)->update(['server_id'=>$id]);
            });
        });
    }
    public function down() {
        // Topology and reporting credentials must not be destroyed by a code rollback.
        throw new \RuntimeException('Restore a coordinated database backup to undo network server migration.');
    }
}
