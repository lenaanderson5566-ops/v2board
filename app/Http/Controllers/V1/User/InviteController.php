<?php

namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Models\CommissionLog;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\Request;

class InviteController extends Controller
{
    public function save(Request $request)
    {
        abort(410, __('Public invite codes are no longer supported. Use an email invitation.'));
    }

    public function sendEmail(Request $request)
    {
        $params=$request->validate(['email'=>'required|string|email:strict|max:254']);
        $record=(new \App\Services\EmailInvitationService())->send((int)$request->user['id'],$params['email']);
        return response(['data'=>['id'=>$record->id,'email'=>$record->email,'status'=>'queued']]);
    }
    public function emailHistory(Request $request)
    {
        $params=$request->validate(['days'=>'nullable|integer|in:7,30,90']);
        return response(['data'=>(new \App\Services\EmailInvitationService())->history((int)$request->user['id'],(int)($params['days']??90))]);
    }

    public function details(Request $request)
    {
        $current = $request->input('current') ? $request->input('current') : 1;
        $pageSize = $request->input('page_size') >= 10 ? $request->input('page_size') : 10;
        $builder = CommissionLog::where('invite_user_id', $request->user['id'])
            ->where('get_amount', '>', 0)
            ->select([
                'id',
                'trade_no',
                'order_amount',
                'get_amount',
                'created_at'
            ])
            ->orderBy('created_at', 'DESC');
        $total = $builder->count();
        $details = $builder->forPage($current, $pageSize)
            ->get();
        return response([
            'data' => $details,
            'total' => $total
        ]);
    }

    public function fetch(Request $request)
    {
        $commission_rate = config('v2board.invite_commission', 10);
        $user = User::find($request->user['id']);
        if ($user->commission_rate) {
            $commission_rate = $user->commission_rate;
        }
        $uncheck_commission_balance = (int)Order::where('status', 3)
            ->where('commission_status', 0)
            ->where('invite_user_id', $request->user['id'])
            ->sum('commission_balance');
        if (config('v2board.commission_distribution_enable', 0)) {
            $uncheck_commission_balance = $uncheck_commission_balance * (config('v2board.commission_distribution_l1') / 100);
        }
        $stat = [
            //已注册用户数
            (int)User::where('invite_user_id', $request->user['id'])->count(),
            //有效的佣金
            (int)CommissionLog::where('invite_user_id', $request->user['id'])
                ->sum('get_amount'),
            //确认中的佣金
            $uncheck_commission_balance,
            //佣金比例
            (int)$commission_rate,
            //可用佣金
            (int)$user->commission_balance
        ];
        return response([
            'data' => [
                'stat' => $stat
            ]
        ]);
    }
}
