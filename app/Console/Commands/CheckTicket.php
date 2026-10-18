<?php
namespace App\Console\Commands;

use App\Models\Ticket;
use App\Models\TicketMessage;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckTicket extends Command
{
    protected $signature = 'check:ticket';
    protected $description = 'Close tickets after 24 hours without a user reply';

    public function handle(): int
    {
        $cutoff = time() - 24 * 3600;
        Ticket::where('status', 0)->where('reply_status', 1)
            ->where('updated_at', '<=', $cutoff)
            ->select('id')->chunkById(200, function ($tickets) use ($cutoff) {
                foreach ($tickets as $candidate) {
                    DB::transaction(function () use ($candidate, $cutoff) {
                        // Recheck under the same lock used by replies. A candidate
                        // may have received a new reply since the initial scan.
                        $ticket = Ticket::whereKey($candidate->id)->lockForUpdate()->first();
                        if (!$ticket || (int) $ticket->status !== 0 || (int) $ticket->reply_status !== 1
                            || (int) $ticket->updated_at > $cutoff) return;
                        $last = TicketMessage::where('ticket_id', $ticket->id)->orderByDesc('id')->first();
                        if (!$last || (int) $last->user_id === (int) $ticket->user_id
                            || (int) $last->created_at > $cutoff) return;
                        $ticket->status = 1;
                        $ticket->save();
                    });
                }
            });
        return 0;
    }
}
