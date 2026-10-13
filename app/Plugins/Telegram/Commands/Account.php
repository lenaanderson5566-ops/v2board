<?php
namespace App\Plugins\Telegram\Commands;
class Account extends \App\Plugins\Telegram\Telegram {
    public $command='/account';
    public $description='查询套餐状态';
    public function handle($message,$match=[]) {
        if (!$message->is_private || (int)$message->sender_id!==(int)$message->chat_id) return;
        app(\App\Services\TelegramBotMenu::class)->send((int)$message->chat_id,'account');
    }
}
