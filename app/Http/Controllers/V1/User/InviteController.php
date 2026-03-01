<?php

namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Models\CommissionLog;
use App\Models\InviteCode;
use App\Models\Order;
use App\Models\User;
use App\Utils\Helper;
use App\Services\CurrencyRateService;
use App\Services\UserService;
use Illuminate\Http\Request;

class InviteController extends Controller
{
    public function save(Request $request)
    {
        if (InviteCode::where('user_id', $request->user['id'])->where('status', 0)->count() >= config('v2board.invite_gen_limit', 5)) {
            abort(500, __('The maximum number of creations has been reached'));
        }
        $inviteCode = new InviteCode();
        $inviteCode->user_id = $request->user['id'];
        $inviteCode->code = Helper::randomChar(8);
        return response([
            'data' => $inviteCode->save()
        ]);
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
                'order_currency',
                'get_amount',
                'get_currency',
                'created_at'
            ])
            ->orderBy('created_at', 'DESC');
        $total = $builder->count();
        $details = $builder->forPage($current, $pageSize)
            ->get();
        $details->transform(function ($item) {
            $item->order_currency = strtoupper($item->order_currency ?: 'CNY');
            $item->get_currency = strtoupper($item->get_currency ?: 'CNY');
            return $item;
        });
        return response([
            'data' => $details,
            'total' => $total
        ]);
    }

    public function fetch(Request $request)
    {
        $codes = InviteCode::where('user_id', $request->user['id'])
            ->where('status', 0)
            ->get();
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
        $currencyRateService = new CurrencyRateService();
        $baseCurrency = $currencyRateService->getBusinessBaseCurrency();
        $effectiveCommission = 0;
        $commissionGroups = CommissionLog::where('invite_user_id', $request->user['id'])
            ->selectRaw('COALESCE(get_currency, "CNY") as get_currency, SUM(get_amount) as total_amount')
            ->groupBy('get_currency')
            ->get();
        foreach ($commissionGroups as $group) {
            $effectiveCommission += $currencyRateService->convertMinor((int)$group->total_amount, strtoupper($group->get_currency ?: 'CNY'), $baseCurrency);
        }

        $stat = [
            //已注册用户数
            (int)User::where('invite_user_id', $request->user['id'])->count(),
            //有效的佣金
            (int)$effectiveCommission,
            //确认中的佣金
            $currencyRateService->convertMinor((int)$uncheck_commission_balance, 'CNY', $baseCurrency),
            //佣金比例
            (int)$commission_rate,
            //可用佣金（新逻辑按基准币种记账）
            (int)$user->commission_balance
        ];
        return response([
            'data' => [
                'codes' => $codes,
                'wallet_currency' => $baseCurrency,
                'stat' => $stat
            ]
        ]);
    }
}
