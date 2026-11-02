<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Services\TimeZones;

class RunDailyTask extends Command {
    public const TASKS=['reset:traffic'=>'00:00','reset:log'=>'00:00','fastai:statistics'=>'00:10','send:remindMail'=>'11:30','check:renewal'=>'22:30'];
    protected $signature='system:daily {task}';
    protected $description='Run a daily task once per business date in the configured system time zone';
    public static function canonicalTask(string $task): string { return $task==='v2board:statistics' ? 'fastai:statistics' : $task; }
    /** Retain the recorded task and lock identity to avoid a second daily settlement. */
    public static function persistentTask(string $task): string { return self::canonicalTask($task)==='fastai:statistics' ? 'v2board:statistics' : $task; }
    public static function due(string $task, \DateTimeImmutable $now): bool { $task=self::canonicalTask($task);return isset(self::TASKS[$task]) && $now->format('H:i')>=self::TASKS[$task]; }
    public function handle(): int {
        TimeZones::apply(true);
        $task=self::canonicalTask((string)$this->argument('task'));
        if (!isset(self::TASKS[$task])) return 1;
        $now=new \DateTimeImmutable('now',new \DateTimeZone(TimeZones::system()));
        if (!self::due($task,$now)) return 0;
        $date=$now->format('Y-m-d');
        $identity=self::persistentTask($task);
        $lock=Cache::lock('system:daily:'.$identity,3600);
        if (!$lock->get()) return 0;
        try {
            $query=DB::table('v2_daily_task_run')->where('task',$identity)->where('business_date',$date);
            $row=$query->first();
            if ($row && in_array($row->status,['completed','skipped_upgrade'],true)) return 0;
            if ($row && $row->status==='failed' && $row->updated_at>time()-300) return 0;
            DB::table('v2_daily_task_run')->updateOrInsert(['task'=>$identity,'business_date'=>$date],['timezone'=>TimeZones::system(),'status'=>'running','updated_at'=>time()]);
            try { $code=$this->call($task); }
            catch (\Throwable $e) { $query->update(['status'=>'failed','updated_at'=>time()]); throw $e; }
            $query->update(['status'=>$code===0?'completed':'failed','updated_at'=>time()]);
            return $code;
        } finally { $lock->release(); }
    }
}
