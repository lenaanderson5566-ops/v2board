<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasColumn('v2_user','display_timezone')) Schema::table('v2_user',function (Blueprint $t) { $t->string('display_timezone',64)->nullable(); });
        foreach (['v2_stat_user','v2_node_traffic_batch'] as $table) if (!Schema::hasColumn($table,'record_timezone')) Schema::table($table,function (Blueprint $t) { $t->string('record_timezone',64)->nullable(); });
        if (!Schema::hasTable('v2_daily_task_run')) {
            Schema::create('v2_daily_task_run',function (Blueprint $t) {
                $t->string('task',48); $t->date('business_date'); $t->string('timezone',64);
                $t->string('status',16); $t->unsignedInteger('updated_at');
                $t->primary(['task','business_date']);
            });
            $zone=\App\Services\TimeZones::system();
            $now=new \DateTimeImmutable('now',new \DateTimeZone($zone));
            foreach (\App\Console\Commands\RunDailyTask::TASKS as $task=>$at) if ($now->format('H:i')>=$at) {
                // Legacy tasks may already have run today before this migration.
                DB::table('v2_daily_task_run')->insert(['task'=>$task,'business_date'=>$now->format('Y-m-d'),'timezone'=>$zone,'status'=>'skipped_upgrade','updated_at'=>time()]);
            }
        }
        if (!Schema::hasTable('v2_daily_user_reset')) Schema::create('v2_daily_user_reset',function (Blueprint $t) {
            $t->unsignedBigInteger('user_id'); $t->date('business_date'); $t->primary(['user_id','business_date']);
        });
    }
    public function down(): void {
        foreach (['v2_stat_user','v2_node_traffic_batch'] as $table) if (Schema::hasColumn($table,'record_timezone')) Schema::table($table,function (Blueprint $t) { $t->dropColumn('record_timezone'); });
        Schema::dropIfExists('v2_daily_user_reset'); Schema::dropIfExists('v2_daily_task_run');
        if (Schema::hasColumn('v2_user','display_timezone')) Schema::table('v2_user',function (Blueprint $t) { $t->dropColumn('display_timezone'); });
    }
};
