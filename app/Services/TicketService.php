<?php
namespace App\Services;


use App\Jobs\SendEmailJob;
use App\Models\Ticket;
use App\Models\TicketMessage;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

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
        try {
            $this->sendEmailNotify($ticket);
        } catch (\Throwable $error) {
            // The reply has already been saved. A notification failure must not invite resubmission.
            Log::warning('Ticket reply notification could not be queued', [
                'ticketId' => $ticket->id,
                'exceptionClass' => get_class($error),
            ]);
        }
    }

    // 半小时内不再重复通知
    private function sendEmailNotify(Ticket $ticket)
    {
        $user = User::find($ticket->user_id);
        if (!$user || $user->account_deleted_at) return;

        $cacheKey = 'ticket_sendEmailNotify_' . $ticket->user_id;
        if (!Cache::add($cacheKey, 1, 1800)) return;

        try {
            SendEmailJob::dispatch([
                'email' => $user->email,
                'user_id' => $user->id,
                'subject' => '您在' . \App\Support\Branding::name(config('fastai.app_name', config('app.name', 'FastAI'))) . '的工单得到了回复',
                'template_name' => 'ticketReply',
                'template_value' => [
                    'name' => \App\Support\Branding::name(config('fastai.app_name', config('app.name', 'FastAI'))),
                    'url' => config('fastai.app_url'),
                    'ticket_id' => (int) $ticket->id
                ]
            ]);
        } catch (\Throwable $error) {
            Cache::forget($cacheKey);
            throw $error;
        }
    }
}
