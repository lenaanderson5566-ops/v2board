<?php
namespace App\Plugins\Telegram\Commands;
use App\Plugins\Telegram\Telegram;
use App\Services\TelegramCommunityService;
class Start extends Telegram {
    public $command='/start';
    public $description='绑定账号与使用说明';
    public function handle($message,$match=[]) {
        if (!$message->is_private || (int)$message->sender_id!==(int)$message->chat_id) return;
        $argument=$message->args[0]??'';
        if (str_starts_with($argument,'bind_')) {
            app(TelegramCommunityService::class)->acceptBinding(substr($argument,5),(int)$message->sender_id,$message->sender_name);
            $this->telegramService->sendMessage($message->chat_id,\App\Services\TelegramText::get('confirmed',$message->language));
            return;
        }
        $this->telegramService->sendMessage($message->chat_id,\App\Services\TelegramText::get('intro',$message->language));
    }
}
