<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
class IndexLogMetadata extends Migration {
    private const INDEXES=[
        'v2_log'=>[
            'log_request_id_idx'=>['request_id'], 'log_created_id_idx'=>['created_at','id'],
            'log_level_created_idx'=>['level','created_at','id'], 'log_status_created_idx'=>['http_status','created_at','id'],
            'log_metadata_pending_idx'=>['metadata_indexed','id'],
        ],
        'v2_login_log'=>['v2_login_log_created_id_idx'=>['created_at','id']],
        'v2_subscribe_log'=>['v2_subscribe_log_created_id_idx'=>['created_at','id']],
    ];
    public function up() {
        foreach (['request_id','http_status','duration_ms','route_template','metadata_indexed'] as $column) {
            if (Schema::hasColumn('v2_log',$column)) continue;
            Schema::table('v2_log',function(Blueprint $t) use($column) {
                match($column) {
                    'request_id'=>$t->string($column,36)->nullable(),
                    'http_status'=>$t->unsignedSmallInteger($column)->nullable(),
                    'duration_ms'=>$t->unsignedInteger($column)->nullable(),
                    'route_template'=>$t->string($column,512)->nullable(),
                    'metadata_indexed'=>$t->boolean($column)->default(false),
                };
            });
        }
        foreach(self::INDEXES as $table=>$indexes) foreach($indexes as $name=>$columns) {
            if (!Schema::hasIndex($table,$name)) Schema::table($table,function(Blueprint $t) use($name,$columns) {$t->index($columns,$name);});
        }
    }
    public function down() {
        foreach(self::INDEXES as $table=>$indexes) foreach($indexes as $name=>$columns) {
            if (Schema::hasTable($table) && Schema::hasIndex($table,$name)) Schema::table($table,function(Blueprint $t) use($name) {$t->dropIndex($name);});
        }
        Schema::table('v2_log',function(Blueprint $t) {$t->dropColumn(['request_id','http_status','duration_ms','route_template','metadata_indexed']);});
    }
}
