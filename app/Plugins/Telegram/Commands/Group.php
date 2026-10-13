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
        $this->telegramService->sendMessage($message->chat_id,$allowed ? '你当前具备群资格。请在网站账号设置中点击“申请加入会员群”，获取有效期 10 分钟的申请链接。' : '暂不具备群资格。请在网站绑定账号并确认套餐有效期；到期宽限为 '.$service->graceDays().' 天。');
    }
}
