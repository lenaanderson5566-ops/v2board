<?php
namespace App\Plugins\Telegram\Commands;
class Traffic extends \App\Plugins\Telegram\Telegram {
    public $command='/traffic';
    public $description='查询剩余流量';
    public function handle($message,$match=[]) {
        if (!$message->is_private || (int)$message->sender_id!==(int)$message->chat_id) return;
        app(\App\Services\TelegramBotMenu::class)->send((int)$message->chat_id,'traffic');
    }
}
