<?php
namespace App\Plugins\Telegram\Commands;
class UnBind extends \App\Plugins\Telegram\Telegram {
    public $command='/unbind';
    public $description='查看解除绑定方式';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $this->telegramService->sendMessage($message->chat_id,\App\Services\TelegramText::get('unbind',$message->language));
    }
}
