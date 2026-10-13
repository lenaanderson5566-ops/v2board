<?php

namespace App\Services\Actions\User;


use App\Http\Requests\User\TicketSave;
use App\Http\Requests\User\TicketWithdraw;
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Services\TicketService;
use App\Models\Ticket;
use App\Models\TicketMessage;
use App\Utils\Dict;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TicketActions
{
    public function fetch(Request $request)
    {
        $userId = $request->user['id'];
        $ticketId = $request->input('id');

        if ($ticketId) {
            $ticket = Ticket::where('id', $ticketId)
                ->where('user_id', $userId)
                ->firstOrFail();

            $ticket['message'] = TicketMessage::where('ticket_id', $ticket->id)->get();
            for ($i = 0; $i < count($ticket['message']); $i++) {
                if ($ticket['message'][$i]['user_id'] !== $ticket->user_id) {
                    $ticket['message'][$i]['is_me'] = false;
                } else {
                    $ticket['message'][$i]['is_me'] = true;
                }
            }

            return response(['data' => $ticket]);

        }
        $query = Ticket::where('user_id', $userId)->orderBy('created_at', 'DESC')->orderByDesc('id');
        $total=null;
        if ($request->is('api/v10/*')) {
            $total=(clone $query)->count();
            $query->forPage((int)$request->input('current',1),(int)$request->input('page_size',20));
        }
        $ticket=$query->get();
        return response([
            'data' => $ticket,
            ...($total !== null ? ['total'=>$total] : [])
        ]);
    }

    public function save(TicketSave $request)
    {
        try {
            DB::beginTransaction();
            if ((int)Ticket::where('status', 0)->where('user_id', $request->user['id'])->lockForUpdate()->count()) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('There are other unresolved tickets'));
            }

            $policy = \App\Services\TicketPolicy::creation((int)$request->user['id']);
            if ($policy !== 'allowed') abort(request()->is('api/v10/*') ? 403 : 500, $policy === 'purchase_required' ? __('请先购买套餐') : __('当前套餐不允许发起工单'));

            $ticketData = $request->only(['subject', 'level']) + ['user_id' => $request->user['id']];
            $ticket = Ticket::create($ticketData);

            TicketMessage::create([
                'user_id' => $request->user['id'],
                'ticket_id' => $ticket->id,
                'message' => $request->input('message')
            ]);

            DB::commit();
            return response([
                'data' => $request->is('api/v10/*') ? $ticket : true
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            if ($request->is('api/v10/*') && $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) throw $e;
            abort(500, $e->getMessage());
        }
    }

    public function reply(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Invalid parameter'));
        }
        if (empty($request->input('message'))) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Message cannot be empty'));
        }
        $ticket = Ticket::where('id', $request->input('id'))
            ->where('user_id', $request->user['id'])
            ->first();
        if (!$ticket) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Ticket does not exist'));
        }
        if ($ticket->status) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The ticket is closed and cannot be replied'));
        }
        if ($request->user['id'] == $this->getLastMessage($ticket->id)->user_id) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Please wait for the technical enginneer to reply'));
        }
        $ticketService = new TicketService();
        if (
			!$ticketService->reply(
				$ticket,
				$request->input('message'),
				$request->user['id']
			)
		) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Ticket reply failed'));
        }
        return response([
            'data' => true
        ]);
    }


    public function close(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Invalid parameter'));
        }
        $ticket = Ticket::where('id', $request->input('id'))
            ->where('user_id', $request->user['id'])
            ->first();
        if (!$ticket) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Ticket does not exist'));
        }
        $ticket->status = 1;
        if (!$ticket->save()) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Close failed'));
        }
        return response([
            'data' => true
        ]);
    }

    private function getLastMessage($ticketId)
    {
        return TicketMessage::where('ticket_id', $ticketId)
            ->orderBy('id', 'DESC')
            ->first();
    }

    public function withdraw(TicketWithdraw $request)
    {
        if ((int)config('v2board.withdraw_close_enable', 0)) {
            abort(500, 'user.ticket.withdraw.not_support_withdraw');
        }
        if (
			!in_array(
				$request->input('withdraw_method'),
				config(
					'v2board.commission_withdraw_method',
					Dict::WITHDRAW_METHOD_WHITELIST_DEFAULT
				)
			)
		) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Unsupported withdrawal method'));
        }
        $user = User::find($request->user['id']);
        $limit = config('v2board.commission_withdraw_limit', 100);
        if ($limit > ($user->commission_balance / 100)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The current required minimum withdrawal commission is :limit', ['limit' => $limit]));
        }
        DB::beginTransaction();
        $subject = __('[Commission Withdrawal Request] This ticket is opened by the system');
        $ticket = Ticket::create([
            'subject' => $subject,
            'level' => 2,
            'user_id' => $request->user['id']
        ]);
        if (!$ticket) {
            DB::rollback();
            abort(request()->is('api/v10/*') ? 409 : 500, __('Failed to open ticket'));
        }
        $message = sprintf(
			"%s\r\n%s",
            __('Withdrawal method') . "：" . $request->input('withdraw_method'),
            __('Withdrawal account') . "：" . $request->input('withdraw_account')
        );
        $ticketMessage = TicketMessage::create([
            'user_id' => $request->user['id'],
            'ticket_id' => $ticket->id,
            'message' => $message
        ]);
        if (!$ticketMessage) {
            DB::rollback();
            abort(request()->is('api/v10/*') ? 409 : 500, __('Failed to open ticket'));
        }
        DB::commit();
        return response([
            'data' => $request->is('api/v10/*') ? $ticket : true
        ]);
    }

}
