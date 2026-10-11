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
        Cache::put(CacheKey::get('SCHEDULE_LAST_CHECK_AT', null), time());
        $schedule->command('nodes:sync-ddns')->everyMinute()->withoutOverlapping(5);
        // traffic
        $schedule->command('credits:expire')->everyMinute()->withoutOverlapping();
        $schedule->command('traffic:update')->everyMinute()->withoutOverlapping();
        // v2board
        $schedule->command('v2board:statistics')->dailyAt('0:10');
        // check
        $schedule->command('check:order')->everyMinute()->withoutOverlapping();
        $schedule->command('check:commission')->everyFifteenMinutes();
        $schedule->command('check:ticket')->everyMinute();
        $schedule->command('check:renewal')->dailyAt('22:30');
        // reset
        $schedule->command('reset:traffic')->daily();
        $schedule->command('reset:log')->daily()->withoutOverlapping();
        $schedule->command('logs:prune')->everyFiveMinutes()->withoutOverlapping(5)->runInBackground();
        // send
        $schedule->command('send:remindMail')->dailyAt('11:30');
        // horizon metrics
        $schedule->command('horizon:snapshot')->everyFiveMinutes();
        $schedule->command('clients:check-releases')->cron('17 */6 * * *')->withoutOverlapping(10)->runInBackground();
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
