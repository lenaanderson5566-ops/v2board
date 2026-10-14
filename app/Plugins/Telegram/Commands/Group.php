<?php
namespace App\Plugins\Telegram\Commands;
use App\Plugins\Telegram\Telegram;
use App\Services\TelegramCommunityService;
class Group extends Telegram {
    public $command='/group';
    public $description='查询会员群资格';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $service=app(TelegramCommunityService::class);
        $allowed=$service->enabled() && $service->eligible($service->userForTelegram((int)$message->chat_id));
        $this->telegramService->sendMessage($message->chat_id,\App\Services\TelegramText::get($allowed?'eligible':'ineligible',$message->language,['days'=>$service->graceDays()]));
    }
}
