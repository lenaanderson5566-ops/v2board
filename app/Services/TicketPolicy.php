<?php
namespace App\Services;
use App\Models\Order;
final class TicketPolicy {
    public static function creation(int $userId): string {
        $mode = (int)config('v2board.ticket_status', 0);
        if ($mode === 0) return 'allowed';
        if ($mode === 1) return Order::where('user_id',$userId)->whereIn('status',[3,4])->exists() ? 'allowed' : 'purchase_required';
        return 'closed';
    }
}
