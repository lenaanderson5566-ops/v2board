<?php
namespace App\Plugins\Telegram\Commands;
class Help extends \App\Plugins\Telegram\Telegram {
    public $command='/help';
    public $description='服务菜单与使用说明';
    public function handle($message,$match=[]) {
        if (!$message->is_private || (int)$message->sender_id!==(int)$message->chat_id) return;
        app(\App\Services\TelegramBotMenu::class)->send((int)$message->chat_id,'home');
    }
}
