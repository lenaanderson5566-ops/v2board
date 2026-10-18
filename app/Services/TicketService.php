<?php
namespace App\Services;


use App\Jobs\SendEmailJob;
use App\Models\Ticket;
use App\Models\TicketMessage;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TicketService {
    public function reply($ticket, $message, $userId)
    {
        return DB::transaction(function () use ($ticket, $message, $userId) {
            $ticket = Ticket::whereKey($ticket->id)->lockForUpdate()->first();
            if (!$ticket || (int) $ticket->status !== 0) abort(409, '工单已关闭，请刷新后查看');
            $ticketMessage = TicketMessage::create([
                'user_id' => $userId,
                'ticket_id' => $ticket->id,
                'message' => $message
            ]);
            $ticket->reply_status = (int) $userId !== (int) $ticket->user_id ? 1 : 0;
            $ticket->touch();
            return $ticketMessage;
        });
    }

    public function replyByAdmin($ticketId, $message, $userId): void
    {
        $ticket = Ticket::find($ticketId);
        if (!$ticket) abort(404, '工单不存在');
        $this->reply($ticket, $message, $userId);
        $this->sendEmailNotify($ticket);
    }

    // 半小时内不再重复通知
    private function sendEmailNotify(Ticket $ticket)
    {
        $user = User::find($ticket->user_id);
        $cacheKey = 'ticket_sendEmailNotify_' . $ticket->user_id;
        if (!Cache::get($cacheKey)) {
            Cache::put($cacheKey, 1, 1800);
            SendEmailJob::dispatch([
                'email' => $user->email,
                'subject' => '您在' . config('v2board.app_name', 'V2Board') . '的工单得到了回复',
                'template_name' => 'ticketReply',
                'template_value' => [
                    'name' => config('v2board.app_name', 'V2Board'),
                    'url' => config('v2board.app_url'),
                    'ticket_id' => (int) $ticket->id
                ]
            ]);
        }
    }
}
