<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;

// Compatibility for installations with an older external cron entry.
class SendTelegramNotifications extends Command {
    protected $signature = 'telegram:notify';
    protected $description = 'Retired: Telegram only manages group membership';
    public function handle(): int {
        $this->info('Telegram notifications are retired; no messages were sent.');
        return 0;
    }
}
