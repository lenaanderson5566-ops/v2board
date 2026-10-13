<?php
namespace App\Plugins\Telegram\Commands;
class ReplyTicket extends \App\Plugins\Telegram\Telegram {
    public $regex='/[#]([0-9]+)/';
    public $description='工单处理指引';
    public function handle($message,$match=[]) {
        if (!$message->is_private) return;
        $this->telegramService->sendMessage($message->chat_id,'请登录网站查看并回复工单。机器人不接收工单正文，也不执行管理员工单操作。');
    }
}
