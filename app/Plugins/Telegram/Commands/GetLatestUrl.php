<?php
namespace App\Plugins\Telegram\Commands;
class GetLatestUrl extends \App\Plugins\Telegram\Telegram {
    public $command='/getlatesturl';
    public $description='获取网站入口';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $url=app(\App\Services\TelegramBotMenu::class)->url();
        $this->telegramService->sendMessage($message->chat_id,$url?'网站入口：'.$url:'网站入口暂未配置，请通过已有的可信地址访问。');
    }
}
