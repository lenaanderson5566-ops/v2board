<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_node_target_snapshot','daily_archived')) Schema::table('v2_node_target_snapshot',fn(Blueprint $t)=>$t->boolean('daily_archived')->default(false));
        if (!Schema::hasTable('v2_node_target_day')) Schema::create('v2_node_target_day',function(Blueprint $t){
            $t->string('id',64)->primary(); $t->unsignedInteger('node_id'); $t->unsignedBigInteger('day_at');
            $t->unsignedBigInteger('expires_at')->index(); $t->unsignedInteger('target_count')->default(0);
            $t->unsignedBigInteger('omitted')->default(0); $t->unsignedBigInteger('source_dropped')->default(0);
            $t->unsignedBigInteger('last_bucket_at'); $t->index(['node_id','day_at']);
        });
        if (!Schema::hasTable('v2_node_target_daily')) Schema::create('v2_node_target_daily',function(Blueprint $t){
            $t->string('id',64)->primary(); $t->unsignedInteger('node_id'); $t->unsignedBigInteger('day_at');
            $t->string('type',8); $t->string('target',253); $t->unsignedBigInteger('connections');
            $t->unsignedBigInteger('upload_bytes'); $t->unsignedBigInteger('download_bytes'); $t->unsignedBigInteger('total_bytes');
            $t->unsignedBigInteger('expires_at')->index(); $t->index(['node_id','day_at','total_bytes'],'target_daily_lookup');
        });
    }
    public function down(): void {
        Schema::dropIfExists('v2_node_target_daily'); Schema::dropIfExists('v2_node_target_day');
        if (Schema::hasColumn('v2_node_target_snapshot','daily_archived')) Schema::table('v2_node_target_snapshot',fn(Blueprint $t)=>$t->dropColumn('daily_archived'));
    }
};
