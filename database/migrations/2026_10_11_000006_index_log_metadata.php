<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
class IndexLogMetadata extends Migration {
    public function up() {
        Schema::table('v2_log',function(Blueprint $t) {
            $t->string('request_id',36)->nullable()->index('log_request_id_idx');
            $t->unsignedSmallInteger('http_status')->nullable();
            $t->unsignedInteger('duration_ms')->nullable();
            $t->string('route_template',512)->nullable();
            $t->boolean('metadata_indexed')->default(false);
            $t->index(['created_at','id'],'log_created_id_idx');
            $t->index(['level','created_at','id'],'log_level_created_idx');
            $t->index(['http_status','created_at','id'],'log_status_created_idx');
            $t->index(['metadata_indexed','id'],'log_metadata_pending_idx');
        });
        foreach (['v2_login_log','v2_subscribe_log'] as $table) Schema::table($table,function(Blueprint $t) use($table) { $t->index(['created_at','id'],$table.'_created_id_idx'); });
    }
    public function down() {
        foreach (['v2_login_log','v2_subscribe_log'] as $table) Schema::table($table,function(Blueprint $t) use($table) { $t->dropIndex($table.'_created_id_idx'); });
        Schema::table('v2_log',function(Blueprint $t) {
            foreach (['log_request_id_idx','log_created_id_idx','log_level_created_idx','log_status_created_idx','log_metadata_pending_idx'] as $index) $t->dropIndex($index);
            $t->dropColumn(['request_id','http_status','duration_ms','route_template','metadata_indexed']);
        });
    }
}
