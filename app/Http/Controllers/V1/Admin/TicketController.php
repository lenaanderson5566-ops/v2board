<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Ticket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\TicketService;
use Illuminate\Http\Request;

class TicketController extends Controller
{
    public function fetch(Request $request)
    {
        $params = $request->validate(['id' => 'nullable|integer|min:1']);
        if (isset($params['id'])) {
            $ticket = Ticket::find($params['id']);
            if (!$ticket) {
                abort(404, '工单不存在');
            }
            \App\Services\AdminUserIdentity::append(collect([$ticket]));
            $ticket['message'] = TicketMessage::where('ticket_id', $ticket->id)->get();
            for ($i = 0; $i < count($ticket['message']); $i++) {
                if ($ticket['message'][$i]['user_id'] !== $ticket->user_id) {
                    $ticket['message'][$i]['is_me'] = true;
                } else {
                    $ticket['message'][$i]['is_me'] = false;
                }
            }
            return response([
                'data' => $ticket
            ]);
        }
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $model = Ticket::orderBy('updated_at', 'DESC');
        if ($request->input('status') !== NULL) {
            $model->where('status', $request->input('status'));
        }
        if ($request->input('reply_status') !== NULL) {
            $model->whereIn('reply_status', $request->input('reply_status'));
        }
        if ($request->input('email') !== NULL) {
            $user = User::where('email', $request->input('email'))->first();
            $model->where('user_id', $user ? $user->id : 0);
        }
        $total = $model->count();
        $res = $model->forPage($current, $pageSize)
            ->get();
        \App\Services\AdminUserIdentity::append($res);
        return response([
            'data' => $res,
            'total' => $total
        ]);
    }

    public function reply(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1', 'message' => 'required|string|max:10000']);
        $ticketService = new TicketService();
        $ticketService->replyByAdmin(
            $params['id'],
            $params['message'],
            $request->user['id']
        );
        return response([
            'data' => true
        ]);
    }

    public function close(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1']);
        $ticket = Ticket::find($params['id']);
        if (!$ticket) {
            abort(404, '工单不存在');
        }
        $ticket->status = 1;
        if (!$ticket->save()) {
            abort(500, '关闭失败');
        }
        return response([
            'data' => true
        ]);
    }
}
