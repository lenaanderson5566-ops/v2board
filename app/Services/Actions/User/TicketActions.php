<?php

namespace App\Services\Actions\User;


use App\Http\Requests\User\TicketSave;
use App\Http\Requests\User\TicketWithdraw;
use App\Jobs\SendTelegramJob;
use App\Models\User;
use App\Models\Plan;
use App\Models\Order;
use App\Services\TelegramService;
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
            $this->notifySafely($ticket, $request->input('message'),$request->user['id']);
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
        $this->notifySafely($ticket, $request->input('message'), $request->user['id']);
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
        $this->notifySafely($ticket, $message);
        return response([
            'data' => $request->is('api/v10/*') ? $ticket : true
        ]);
    }

    private function notifySafely(Ticket $ticket, string $message, $userid = null)
    {
        if (!(int)config('v2board.telegram_bot_enable', 0)) return;
        try { $this->sendNotify($ticket, $message, $userid); }
        catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Ticket notification could not be queued', ['ticketId'=>$ticket->id,'exceptionClass'=>get_class($e)]);
        }
    }

    private function sendNotify(Ticket $ticket, string $message, $userid = null)
	{
		$telegramService = new TelegramService();
		if (!empty($userid)) {
			$user = User::find($userid);

			if ($user) {
				$transfer_enable = $this->getFlowData($user->transfer_enable); // 总流量
				$remaining_traffic = $this->getFlowData((\App\Services\TrafficCreditService::hasPeriod($user) ? max(0, $user->transfer_enable - $user->u - $user->d) : 0) + (int)$user->credit_balance); // 剩余流量
				$u = $this->getFlowData($user->u); // 上传
				$d = $this->getFlowData($user->d); // 下载
				$expired_at = date("Y-m-d H:i:s", $user->expired_at); // 到期时间
                $ip_address = request()->ip();
                $geo = app(\App\Services\GeoIpService::class)->lookup($ip_address);
                $location = implode(', ', array_filter([$geo['city'] ?? null, $geo['country'] ?? null])) ?: '无法确定用户地址';

				$plan = Plan::where('id', $user->plan_id)->first();
				$planName = $plan ? $plan->name : '未找到套餐信息'; // Check if plan data is available

				$money = \App\Services\Money::format($user->balance);
				$affmoney = \App\Services\Money::format($user->commission_balance);
				$telegramService->sendMessageWithAdmin("📮工单提醒 #{$ticket->id}\n———————————————\n邮箱：\n`{$user->email}`\n用户位置：\n`{$location}`\nIP:\n{$ip_address}\n套餐与流量：\n`{$planName} of {$transfer_enable}/{$remaining_traffic}`\n上传/下载：\n`{$u}/{$d}`\n到期时间：\n`{$expired_at}`\n余额/佣金余额：\n`{$money}/{$affmoney}`\n主题：\n`{$ticket->subject}`\n内容：\n {$message} ", true);
			} else {
				// Handle case where user data is not found
				$telegramService->sendMessageWithAdmin("User data not found for user ID: {$userid}", true);
			}
		} else {
			$telegramService->sendMessageWithAdmin("📮工单提醒 #{$ticket->id}\n———————————————\n主题：\n`{$ticket->subject}`\n内容：\n {$message} ", true);
		}
	}

    private function getFlowData($b)
    {
        $g = $b / (1024 * 1024 * 1024); // 转换流量数据
        $m = $b / (1024 * 1024);
        if ($g >= 1) {
            $text = round($g, 2) . "GB";
        } else {
            $text = round($m, 2) . "MB";
        }
        return $text;
    }
}
