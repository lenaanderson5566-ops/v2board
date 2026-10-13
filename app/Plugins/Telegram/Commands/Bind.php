<?php
namespace App\Plugins\Telegram\Commands;
use App\Plugins\Telegram\Telegram;
class Bind extends Telegram {
    public $command='/bind';
    public $description='查看安全绑定方式';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $this->telegramService->sendMessage($message->chat_id,'请登录网站，在账号设置中获取一次性绑定链接。请勿发送密码、验证码或订阅链接。');
    }
}
