<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\CommissionLog;
use App\Models\Order;
use App\Models\ServerV2box;
use App\Models\Stat;
use App\Models\StatServer;
use App\Models\StatUser;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StatController extends Controller
{
    public function getOverride(Request $request)
    {
        return \App\Services\DashboardRevenue::cachedOverview(fn()=>[
            'data' => array_merge(\App\Services\DashboardRevenue::summary(), [
                'financial' => \App\Services\DashboardRevenue::financial(),
                'usage' => \App\Services\DashboardUsage::summary(),
                'online_user' => User::where('t','>=', time() - 600)
                    ->count(),
                'month_register_total' => User::where('created_at', '>=', strtotime(date('Y-m-1')))
                    ->where('created_at', '<', time())
                    ->count(),
                'day_register_total' => User::where('created_at', '>=', strtotime(date('Y-m-d')))
                    ->where('created_at', '<', time())
                    ->count(),
                'ticket_pending_total' => Ticket::where('status', 0)
                    ->where('reply_status', 0)
                    ->count(),
                'commission_pending_total' => Order::where('commission_status', 0)
                    ->where('invite_user_id', '!=', NULL)
                    ->whereNotIn('status', [0, 2])
                    ->where('commission_balance', '>', 0)
                    ->count(),
                'commission_month_payout' => CommissionLog::where('created_at', '>=', strtotime(date('Y-m-1')))
                    ->where('created_at', '<', time())
                    ->where('currency','CNY')->sum('get_amount'),
                'commission_last_month_payout' => CommissionLog::where('created_at', '>=', strtotime('-1 month', strtotime(date('Y-m-1'))))
                    ->where('created_at', '<', strtotime(date('Y-m-1')))
                    ->where('currency','CNY')->sum('get_amount'),
            ])
        ]);
    }

    public function getOrder(Request $request)
    {
        $statistics = Stat::where('record_type', 'd')
            ->limit(31)
            ->orderBy('record_at', 'DESC')
            ->get()
            ->toArray();
        $result = [];
        foreach ($statistics as $statistic) {
            $date = date('m-d', $statistic['record_at']);
            $result[] = [
                'type' => '注册人数',
                'date' => $date,
                'value' => $statistic['register_count']
            ];
            $result[] = [
                'type' => '收款金额 (CNY)',
                'date' => $date,
                'value' => $statistic['paid_total'] / 100
            ];
            $result[] = [
                'type' => '收款笔数',
                'date' => $date,
                'value' => $statistic['paid_count']
            ];
            $result[] = [
                'type' => '佣金金额(已发放，CNY)',
                'date' => $date,
                'value' => $statistic['commission_total'] / 100
            ];
            $result[] = [
                'type' => '佣金笔数(已发放)',
                'date' => $date,
                'value' => $statistic['commission_count']
            ];
        }
        $result = array_reverse($result);
        return [
            'data' => $result
        ];
    }

    public function getServerLastRank()
    {
        $endAt = strtotime(date('Y-m-d'));
        return $this->serverRank(strtotime('-1 day', $endAt), $endAt);
    }

    public function getServerTodayRank()
    {
        return $this->serverRank(strtotime(date('Y-m-d')), time());
    }

    private function serverRank(int $startAt, int $endAt): array
    {
        $statistics = StatServer::where('server_type', 'v2box')->select([
            'server_id', 'server_type',
            DB::raw('SUM(u) as u'), DB::raw('SUM(d) as d'),
            DB::raw('SUM(u+d) as total'),
        ])
            ->where('record_at', '>=', $startAt)
            ->where('record_at', '<', $endAt)
            ->where('record_type', 'd')
            ->groupBy('server_id', 'server_type')
            ->orderBy('total', 'DESC')
            ->orderBy('server_id')
            ->limit(15)
            ->get()->toArray();
        // Fetch names only for ranked services, not every node and its configuration.
        $names = ServerV2box::whereNull('service_id')
            ->whereIn('id', array_column($statistics, 'server_id'))->pluck('name', 'id');
        foreach ($statistics as &$row) {
            $row['server_name'] = $names->get($row['server_id']);
            $row['u'] = (int) $row['u'];
            $row['d'] = (int) $row['d'];
            $row['total'] = $row['total'] / 1073741824;
        }
        unset($row);
        return ['data' => $statistics];
    }

    public function getUserTodayRank()
    {
        return $this->userRank(strtotime(date('Y-m-d')), time());
    }

    public function getUserLastRank()
    {
        $endAt = strtotime(date('Y-m-d'));
        return $this->userRank(strtotime('-1 day', $endAt), $endAt);
    }

    private function userRank(int $startAt, int $endAt): array
    {
        // Aggregate all rate buckets before limiting; a busy user can have many rows.
        $statistics = StatUser::select([
            'user_id',
            DB::raw('SUM(u) as u'),
            DB::raw('SUM(d) as d'),
            DB::raw('SUM((u + d) * server_rate) as total'),
        ])
            ->where('record_at', '>=', $startAt)
            ->where('record_at', '<', $endAt)
            ->where('record_type', 'd')
            ->groupBy('user_id')
            ->orderBy('total', 'DESC')
            ->orderBy('user_id')
            ->limit(15)
            ->get()
            ->toArray();
        $emails = User::whereIn('id', array_column($statistics, 'user_id'))->pluck('email', 'id');
        foreach ($statistics as &$row) {
            $row['email'] = $emails->get($row['user_id']);
            $row['u'] = (int) $row['u'];
            $row['d'] = (int) $row['d'];
            $row['total'] = $row['total'] / 1073741824;
        }
        unset($row);
        return ['data' => $statistics];
    }

    public function getStatUser(Request $request)
    {
        $request->validate([
            'user_id' => 'required|integer'
        ]);
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $builder = StatUser::orderBy('record_at', 'DESC')->where('user_id', $request->input('user_id'));

        $total = $builder->count();
        $records = $builder->forPage($current, $pageSize)
            ->get();
        return [
            'data' => $records,
            'total' => $total
        ];
    }

}

