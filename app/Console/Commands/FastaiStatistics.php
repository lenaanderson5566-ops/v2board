<?php

namespace App\Console\Commands;

use App\Models\CommissionLog;
use App\Models\Order;
use App\Models\Stat;
use App\Models\StatServer;
use App\Models\User;
use Illuminate\Console\Command;

class FastaiStatistics extends Command
{
    protected $signature = 'fastai:statistics';
    protected $aliases = ['v2board:statistics'];
    protected $description = '归档前一业务日的订单、佣金、注册与流量统计';

    public function handle(): int
    {
        $started = microtime(true);
        $end = strtotime('today');
        $start = strtotime('-1 day', $end);

        // Archived amounts are denominated in CNY. Counts cover all currencies.
        $orders = Order::where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw("COUNT(*) AS orders, SUM(CASE WHEN currency='CNY' THEN total_amount ELSE 0 END) AS amount")
            ->first();
        $paid = Order::where('paid_at', '>=', $start)->where('paid_at', '<', $end)->whereNotIn('status', [0, 2])
            ->selectRaw("COUNT(*) AS orders, SUM(CASE WHEN currency='CNY' THEN total_amount ELSE 0 END) AS amount")
            ->first();
        $commission = CommissionLog::where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw("COUNT(*) AS payouts, SUM(CASE WHEN currency='CNY' THEN get_amount ELSE 0 END) AS amount")
            ->first();
        $users = User::where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw('COUNT(*) AS registrations, COUNT(invite_user_id) AS invited')->first();
        $traffic = StatServer::where('created_at', '>=', $start)->where('created_at', '<', $end)
            ->selectRaw('SUM(u) + SUM(d) AS total')->value('total');

        Stat::updateOrCreate(['record_at' => $start, 'record_type' => 'd'], [
            'order_count' => $orders->orders,
            'order_total' => $orders->amount ?? 0,
            'paid_count' => $paid->orders,
            'paid_total' => $paid->amount ?? 0,
            'commission_count' => $commission->payouts,
            'commission_total' => $commission->amount ?? 0,
            'register_count' => $users->registrations,
            'invite_count' => $users->invited,
            'transfer_used_total' => $traffic ?? 0,
        ]);
        info('每日统计归档完成', ['elapsed_seconds' => round(microtime(true) - $started, 3)]);
        return self::SUCCESS;
    }
}
