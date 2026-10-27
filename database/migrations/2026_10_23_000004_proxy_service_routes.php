<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ProxyServiceRoutes extends Migration {
    public function up() {
        // Validate service associations before changing the schema. Never silently discard a line.
        foreach (['v2_server_v2box'] as $table) {
            if (!Schema::hasColumn($table,'parent_id')) continue;
            $column='parent_id';
            $records=DB::table($table)->get()->keyBy('id');
            foreach($records as $line) if($line->$column) {
                $service=$records->get($line->$column);
                if (!$service || $service->$column || $line->id===$service->id || $line->protocol!==$service->protocol || $line->tls!==$service->tls || $line->network!==$service->network ||
                    array_diff(json_decode($line->group_id?:'[]',true)?:[],json_decode($service->group_id?:'[]',true)?:[])) {
                    throw new RuntimeException("Review service association before upgrade: {$table} #{$line->id}");
                }
                $lineTls=json_decode($line->tls_settings??'{}',true)?:[];
                $serviceTls=json_decode($service->tls_settings??'{}',true)?:[];
                foreach(['server_name','public_key','private_key','short_id','allow_insecure','pinned_peer_cert_sha256'] as $key) {
                    if (($lineTls[$key]??null)!==($serviceTls[$key]??null)) throw new RuntimeException("Review TLS identity before upgrade: {$table} #{$line->id}");
                }
                foreach(['network_settings','encryption_settings'] as $field) if ((json_decode($line->$field??'{}',true)?:[])!=(json_decode($service->$field??'{}',true)?:[])) throw new RuntimeException("Review protocol configuration before upgrade: {$table} #{$line->id}");
                foreach(['cipher','flow','disable_sni','obfs','obfs_password'] as $field) if (($line->$field??null)!=($service->$field??null)) throw new RuntimeException("Review protocol configuration before upgrade: {$table} #{$line->id}");
            }
        }
        // Preserve published IDs. A service owns its default connection; other connections
        // reference that service directly. Nested associations are never supported.
        foreach (['v2_server_v2box'] as $table) {
            // Fresh installs previously created V2Box before the display migration,
            // leaving its metadata columns absent.
            foreach (['region_code'=>2,'city_code'=>64,'display_label'=>64] as $field=>$length) {
                if (!Schema::hasColumn($table,$field)) Schema::table($table,fn(Blueprint $t)=>$t->string($field,$length)->nullable());
            }
            if (!Schema::hasColumn($table,'service_id')) {
                Schema::table($table,fn(Blueprint $t)=>$t->unsignedInteger('service_id')->nullable()->index());
            }
            if (Schema::hasColumn($table,'parent_id')) {
                DB::table($table)->update(['service_id'=>DB::raw('NULLIF(parent_id,0)')]);
                Schema::table($table,fn(Blueprint $t)=>$t->dropColumn('parent_id'));
            }
            // Existing connections now resolve these fields from the service at read time.
            // Null records are already migrated; do not compare them as independent identities on retries.
            $clear=[];
            foreach(['tls_settings','network_settings','encryption_settings','route_id','sing_box'] as $field) if(Schema::hasColumn($table,$field)) $clear[$field]=null;
            if ($clear) DB::table($table)->whereNotNull('service_id')->update($clear);
        }
        if (!Schema::hasTable('v2_node_connection')) Schema::create('v2_node_connection',function(Blueprint $t) {
            $t->increments('id');
            $t->string('node_type',10); $t->unsignedInteger('node_id');
            $t->unique(['node_type','node_id'],'connection_node');
            $t->unsignedInteger('entry_id')->nullable()->index('connection_entry');
            $t->unsignedSmallInteger('entry_port')->nullable();
            $t->text('draft');
            $t->text('published')->nullable();
            $t->bigInteger('verified_at')->default(0);
            $t->unsignedInteger('revision')->default(1);
        });
    }
    public function down() {
        throw new RuntimeException('Restore a coordinated backup to undo proxy service migration.');
    }
}
