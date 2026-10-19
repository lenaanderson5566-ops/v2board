<?php

namespace App\Console\Commands;

use App\Models\CommissionLog;
use Illuminate\Console\Command;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class CheckCommission extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'check:commission';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = '返佣服务';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return mixed
     */
    public function handle()
    {
        $this->autoCheck();
        $this->autoPayCommission();
    }

    public function autoCheck()
    {
        if ((int)config('v2board.commission_auto_check_enable', 1)) {
            Order::where('commission_status', 0)
                ->where('invite_user_id', '!=', NULL)
                ->whereIn('status', [3, 4])
                ->where('updated_at', '<=', strtotime('-3 day', time()))
                ->update([
                    'commission_status' => 1
                ]);
        }
    }

    public function autoPayCommission()
    {
        $orders = Order::where('commission_status', 1)
            ->where('invite_user_id', '!=', NULL)
            ->get();
        foreach ($orders as $order) {
            try {
                DB::transaction(function () use ($order) {
                    $locked = Order::whereKey($order->id)->lockForUpdate()->first();
                    if (!$locked || (int)$locked->commission_status !== 1) return;
                    if (!$this->payHandle($locked->invite_user_id, $locked)) {
                        throw new \RuntimeException('Commission settlement failed');
                    }
                    $locked->commission_status = 2;
                    if (!$locked->save()) throw new \RuntimeException('Commission settlement failed');
                }, 3);
            } catch (\Throwable $e) {
                // Keep the commission pending and isolate failures from other orders.
                \Illuminate\Support\Facades\Log::warning('Commission settlement deferred', [
                    'orderId' => $order->id, 'exceptionClass' => get_class($e),
                ]);
            }
        }
    }

    public function payHandle($inviteUserId, Order $order)
    {
        $level = 3;
        if ((int)config('v2board.commission_distribution_enable', 0)) {
            $commissionShareLevels = [
                0 => (int)config('v2board.commission_distribution_l1'),
                1 => (int)config('v2board.commission_distribution_l2'),
                2 => (int)config('v2board.commission_distribution_l3')
            ];
        } else {
            $commissionShareLevels = [
                0 => 100
            ];
        }
        for ($l = 0; $l < $level; $l++) {
            $inviter = User::whereKey($inviteUserId)->lockForUpdate()->first();
            if (!$inviter || $inviter->account_deleted_at) break;
            if (!isset($commissionShareLevels[$l])) continue;
            $sourceCommission = (int)floor($order->commission_balance * ($commissionShareLevels[$l] / 100));
            $commissionBalance = \App\Services\ExchangeRate::convert($sourceCommission, $order->currency ?: 'CNY', $inviter->currency ?: 'CNY', $order->fx_snapshot ?? []);
            if (!$commissionBalance) continue;
            if ((int)config('v2board.withdraw_close_enable', 0)) {
                $inviter->balance = $inviter->balance + $commissionBalance;
            } else {
                $inviter->commission_balance = $inviter->commission_balance + $commissionBalance;
            }
            if (!$inviter->save()) {
                return false;
            }
            if (!CommissionLog::create([
                'invite_user_id' => $inviteUserId,
                'user_id' => $order->user_id,
                'trade_no' => $order->trade_no,
                'order_amount' => $order->total_amount,
                'get_amount' => $commissionBalance,
                'currency' => $inviter->currency ?: 'CNY',
                'order_currency' => $order->currency ?: 'CNY'
            ])) {
                return false;
            }
            $inviteUserId = $inviter->invite_user_id;
            // update order actual commission balance
            $order->actual_commission_balance = $order->actual_commission_balance + $sourceCommission;
        }
        return true;
    }

}
