<?php
namespace App\Console\Commands;
use App\Services\TelegramNotificationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class SendTelegramNotifications extends Command {
    protected $signature='telegram:notify';
    protected $description='Collect and deliver opt-in service notifications without account secrets';
    public function handle(TelegramNotificationService $service): int {
        \Illuminate\Support\Facades\DB::table('v2_telegram_notification')->where('created_at','<',time()-30*86400)->delete();
        if (!config('v2board.telegram_bot_enable',0)) return 0;
        $lock=Cache::lock('telegram:notify-command',600);
        if (!$lock->get()) return 0;
        try {
            $service->collect();
            if (!Cache::has('telegram:notify-backoff')) {
                $result=$service->deliver();
                Cache::put('telegram:notify-last',['at'=>time()]+$result,86400);
            }
        } finally { $lock->release(); }
        return 0;
    }
}
