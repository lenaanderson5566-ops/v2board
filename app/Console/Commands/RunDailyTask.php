<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Services\TimeZones;

class RunDailyTask extends Command {
    public const TASKS=['reset:traffic'=>'00:00','reset:log'=>'00:00','v2board:statistics'=>'00:10','send:remindMail'=>'11:30','check:renewal'=>'22:30'];
    protected $signature='system:daily {task}';
    protected $description='Run a daily task once per business date in the configured system time zone';
    public static function due(string $task, \DateTimeImmutable $now): bool { return isset(self::TASKS[$task]) && $now->format('H:i')>=self::TASKS[$task]; }
    public function handle(): int {
        TimeZones::apply(true);
        $task=$this->argument('task');
        if (!isset(self::TASKS[$task])) return 1;
        $now=new \DateTimeImmutable('now',new \DateTimeZone(TimeZones::system()));
        if (!self::due($task,$now)) return 0;
        $date=$now->format('Y-m-d');
        $lock=Cache::lock('system:daily:'.$task,3600);
        if (!$lock->get()) return 0;
        try {
            $query=DB::table('v2_daily_task_run')->where('task',$task)->where('business_date',$date);
            $row=$query->first();
            if ($row && in_array($row->status,['completed','skipped_upgrade'],true)) return 0;
            if ($row && $row->status==='failed' && $row->updated_at>time()-300) return 0;
            DB::table('v2_daily_task_run')->updateOrInsert(['task'=>$task,'business_date'=>$date],['timezone'=>TimeZones::system(),'status'=>'running','updated_at'=>time()]);
            try { $code=$this->call($task); }
            catch (\Throwable $e) { $query->update(['status'=>'failed','updated_at'=>time()]); throw $e; }
            $query->update(['status'=>$code===0?'completed':'failed','updated_at'=>time()]);
            return $code;
        } finally { $lock->release(); }
    }
}
