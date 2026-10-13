<?php

namespace App\Console;

use App\Utils\CacheKey;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Illuminate\Support\Facades\Cache;

class Kernel extends ConsoleKernel
{
    /**
     * The Artisan commands provided by your application.
     *
     * @var array
     */
    protected $commands = [
        //
    ];

    /**
     * Define the application's command schedule.
     *
     * @param \Illuminate\Console\Scheduling\Schedule $schedule
     * @return void
     */
    protected function schedule(Schedule $schedule)
    {
        $schedule->call(fn () => Cache::put(CacheKey::get('SCHEDULE_LAST_CHECK_AT', null), time()))->everyMinute()->name('scheduler-heartbeat');
        $schedule->command('nodes:sync-ddns')->everyMinute()->withoutOverlapping(5);
        foreach (\App\Console\Commands\RunDailyTask::TASKS as $task=>$at) {
            $schedule->command('system:daily',[$task])->everyMinute()->withoutOverlapping(60)->runInBackground();
        }
        // traffic
        $schedule->command('traffic:process-batches')->everyMinute()->withoutOverlapping(10);
        $schedule->command('credits:expire')->everyMinute()->withoutOverlapping();
        $schedule->command('traffic:update')->everyMinute()->withoutOverlapping();
        // v2board
        // check
        $schedule->command('check:order')->everyMinute()->withoutOverlapping();
        $schedule->command('check:commission')->everyFifteenMinutes();
        $schedule->command('check:ticket')->everyMinute();
        // reset
        $schedule->command('logs:prune')->everyFiveMinutes()->withoutOverlapping(5)->runInBackground();
        // send
        // horizon metrics
        $schedule->command('horizon:snapshot')->everyFiveMinutes();
        $schedule->command('clients:check-releases')->cron('17 */6 * * *')->withoutOverlapping(10)->runInBackground();
        $schedule->command('telegram:sync-members')->everyMinute()->withoutOverlapping(30)->runInBackground();
        $schedule->command('fastai:prune-uploads')->hourly()->withoutOverlapping(10)->runInBackground();
    }

    /**
     * Register the commands for the application.
     *
     * @return void
     */
    protected function commands()
    {
        $this->load(__DIR__ . '/Commands');

        require base_path('routes/console.php');
    }
}
