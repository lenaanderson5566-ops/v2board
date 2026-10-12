<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        // Original V2Board did not run the operations migrations. Preserve existing tables and policies.
        if (!Schema::hasTable('v2_login_log')) {
            require_once __DIR__.'/2026_02_21_000001_create_login_log_table.php';
            (new CreateLoginLogTable())->up();
        }
        if (!Schema::hasTable('v2_subscribe_log')) {
            require_once __DIR__.'/2026_02_21_000002_create_subscribe_log_table.php';
            (new CreateSubscribeLogTable())->up();
        }
        if (!Schema::hasTable('v2_risk_rule_hit')) {
            require_once __DIR__.'/2026_02_21_000003_create_risk_rule_hit_table.php';
            (new CreateRiskRuleHitTable())->up();
        }
        if (!Schema::hasTable('v2_risk_rule_config')) {
            require_once __DIR__.'/2026_02_21_000005_create_risk_rule_config_table.php';
            (new CreateRiskRuleConfigTable())->up();
        }
        if (!Schema::hasTable('v2_client_strategy')) {
            require_once __DIR__.'/2026_02_26_000006_create_client_strategy_table.php';
            (new CreateClientStrategyTable())->up();
        }
        if (!Schema::hasTable('v2_user_online_snapshot')) {
            require_once __DIR__.'/2026_02_26_000013_create_user_online_snapshot_table.php';
            (new CreateUserOnlineSnapshotTable())->up();
        }
        if (!Schema::hasTable('v2_user_connection_log')) {
            require_once __DIR__.'/2026_02_26_000014_create_user_connection_log_table.php';
            (new CreateUserConnectionLogTable())->up();
        }
        if (!Schema::hasTable('v2_risk_setting')) {
            require_once __DIR__.'/2026_02_26_000016_create_risk_setting_table.php';
            (new CreateRiskSettingTable())->up();
        }
        if (!Schema::hasTable('v2_plan_translation')) {
            require_once __DIR__.'/2026_02_28_000001_create_plan_translations_table.php';
            (new CreatePlanTranslationsTable())->up();
        }
        if (!Schema::hasTable('v2_risk_blacklist_ip')) Schema::create('v2_risk_blacklist_ip', function (Blueprint $table) {
            $table->id();
            $table->string('value', 45)->unique();
            $table->string('remark')->nullable();
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
        if (!Schema::hasTable('v2_risk_blacklist_ua_hash')) Schema::create('v2_risk_blacklist_ua_hash', function (Blueprint $table) {
            $table->id();
            $table->string('value', 64)->unique();
            $table->string('remark')->nullable();
            $table->tinyInteger('is_enabled')->default(1)->index();
            $table->integer('created_at')->nullable();
            $table->integer('updated_at')->nullable();
        });
        foreach (['traffic_u','traffic_d','traffic_total'] as $column) {
            if (!Schema::hasColumn('v2_subscribe_log',$column)) Schema::table('v2_subscribe_log',function(Blueprint $t) use($column) {$t->unsignedBigInteger($column)->nullable();});
        }
        if (!Schema::hasColumn('v2_client_strategy','min_version')) Schema::table('v2_client_strategy',function(Blueprint $t) {$t->string('min_version')->nullable()->index();});
        if (!Schema::hasColumn('v2_risk_blacklist_ua_hash','ua_raw')) Schema::table('v2_risk_blacklist_ua_hash',function(Blueprint $t) {$t->text('ua_raw')->nullable();});
        if (Schema::hasTable('v2_risk_blacklist')) {
            foreach (['ip'=>'v2_risk_blacklist_ip','ua_hash'=>'v2_risk_blacklist_ua_hash'] as $type=>$table) {
                DB::table('v2_risk_blacklist')->where('type',$type)->orderBy('id')->chunkById(200,function($rows) use($table,$type) {
                    foreach($rows as $row) DB::table($table)->insertOrIgnore([
                        'value'=>$type==='ua_hash' ? strtolower($row->value) : $row->value,
                        'remark'=>$row->remark,'is_enabled'=>$row->is_enabled,'created_at'=>$row->created_at,'updated_at'=>$row->updated_at,
                    ]);
                });
            }
        }
        if (!Schema::hasIndex('v2_user_online_snapshot','v2_user_online_snapshot_user_source_unique')) {
            DB::table('v2_user_online_snapshot')->whereIn('id',function($q) {
                $q->select('id')->fromSub(function($q) {
                    $q->select('older.id')->from('v2_user_online_snapshot as older')
                        ->join('v2_user_online_snapshot as newer',function($join) {$join->on('older.user_id','=','newer.user_id')->on('older.source','=','newer.source')->on('older.id','<','newer.id');});
                },'duplicates');
            })->delete();
            if (Schema::hasIndex('v2_user_online_snapshot','v2_user_online_snapshot_unique')) Schema::table('v2_user_online_snapshot',function(Blueprint $t) {$t->dropUnique('v2_user_online_snapshot_unique');});
            Schema::table('v2_user_online_snapshot',function(Blueprint $t) {$t->unique(['user_id','source'],'v2_user_online_snapshot_user_source_unique');});
        }
        if (!Schema::hasColumn('v2_user','last_login_at')) Schema::table('v2_user',function(Blueprint $t) {$t->integer('last_login_at')->nullable();});
        if (!Schema::hasColumn('v2_user','last_login_ip')) Schema::table('v2_user',function(Blueprint $t) {$t->string('last_login_ip',45)->nullable();});
        elseif (Schema::getColumnType('v2_user','last_login_ip')!=='varchar') Schema::table('v2_user',function(Blueprint $t) {$t->string('last_login_ip',45)->nullable()->change();});
    }
    public function down(): void {
        throw new RuntimeException('Operations schema may contain logs and policies. Restore a coordinated backup instead.');
    }
};
