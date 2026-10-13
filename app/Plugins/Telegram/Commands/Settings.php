<?php
namespace App\Plugins\Telegram\Commands;
class Settings extends \App\Plugins\Telegram\Telegram {
    public $command='/settings';
    public $description='通知偏好与免打扰';
    public function handle($message,$match=[]) {
        if (!$message->is_private || (int)$message->sender_id!==(int)$message->chat_id) return;
        app(\App\Services\TelegramBotMenu::class)->send((int)$message->chat_id,'settings');
    }
}
