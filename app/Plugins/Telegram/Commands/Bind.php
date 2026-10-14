<?php
namespace App\Plugins\Telegram\Commands;
use App\Plugins\Telegram\Telegram;
class Bind extends Telegram {
    public $command='/bind';
    public $description='查看安全绑定方式';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $this->telegramService->sendMessage($message->chat_id,\App\Services\TelegramText::get('bind',$message->language));
    }
}
