<?php
namespace App\Console\Commands;

use App\Services\TimeZones;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DailyTaskStatus extends Command
{
    protected $signature = 'system:daily-status';
    protected $description = 'Show business time and daily task execution records (read only)';

    public function handle(): int
    {
        TimeZones::apply(true);
        $now = new \DateTimeImmutable('now', new \DateTimeZone(TimeZones::system()));
        $this->line('Business time: '.$now->format('Y-m-d H:i:s P').' '.TimeZones::system());
        $records = DB::table('v2_daily_task_run')->where('business_date', $now->format('Y-m-d'))->get()->keyBy('task');
        $rows = [];
        foreach (RunDailyTask::TASKS as $task => $at) {
            $row = $records->get($task);
            $rows[] = [$task, $at, $row->status ?? (RunDailyTask::due($task, $now) ? 'pending' : 'not_due'), $row ? TimeZones::format($row->updated_at) : '—'];
        }
        $this->table(['Task', 'Local schedule', 'Today status', 'Updated'], $rows);
        return 0;
    }
}
