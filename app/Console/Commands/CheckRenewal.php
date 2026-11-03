<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use App\Services\BillingCurrency;
use App\Services\OrderService;
use App\Services\UserService;
use App\Utils\Helper;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckRenewal extends Command
{
    protected $signature = 'check:renewal';
    protected $description = '自动续费';

    public function handle(): int
    {
        $now = time();
        $failed = false;
        User::query()->select('id', 'plan_id')->where('auto_renewal', 1)->whereNotNull('plan_id')
            ->where('banned', 0)->whereNull('account_deleted_at')
            ->where('expired_at', '>', $now)->where('expired_at', '<', $now + 2 * 86400)
            ->chunkById(200, function ($candidates) use (&$failed) {
                foreach ($candidates as $candidate) {
                    try {
                        DB::transaction(fn () => $this->renew((int) $candidate->id, (int) $candidate->plan_id), 3);
                    } catch (\Throwable $error) {
                        $failed = true;
                        logger()->warning('Automatic renewal failed', [
                            'userId' => $candidate->id,
                            'exceptionClass' => get_class($error),
                        ]);
                    }
                }
            });
        return $failed ? 1 : 0;
    }

    private function renew(int $userId, int $planId): void
    {
        // Match checkout and plan edits: lock the plan before the account.
        $plan = Plan::whereKey($planId)->sharedLock()->first();
        $user = User::whereKey($userId)->lockForUpdate()->first();
        $now = time();
        if (!$user || !$user->auto_renewal || $user->banned || $user->account_deleted_at || !$user->plan_id
            || (int) $user->plan_id !== $planId
            || $user->expired_at <= $now || $user->expired_at >= $now + 2 * 86400) return;

        // Checkout uses the same user lock. A draft or paid order owns the next
        // change in entitlement, so wait for it to be fulfilled or cancelled.
        if ((new UserService())->isNotCompleteOrderByUserId($userId)) return;

        $period = Order::where('user_id', $userId)->where('plan_id', $user->plan_id)->where('status', 3)
            ->whereIn('period', array_keys(OrderService::STR_TO_TIME))
            ->orderByDesc('created_at')->orderByDesc('id')->value('period');
        $currency = BillingCurrency::account($user);
        $price = $plan && $plan->renew && $period ? BillingCurrency::price($plan, $period, $currency) : null;
        if ($price === null || $price < 0) {
            $this->disable($user);
            return;
        }

        $order = new Order([
            'user_id' => $userId, 'plan_id' => $plan->id, 'currency' => $currency,
            'period' => $period, 'trade_no' => Helper::generateOrderNo(), 'type' => 2,
            'status' => 3, 'paid_at' => $now, 'total_amount' => $price,
        ]);
        (new OrderService($order))->setVipDiscount($user);
        $payable = (int) $order->total_amount;
        if ($user->balance < $payable) {
            $this->disable($user);
            return;
        }

        $start = (int) $user->expired_at;
        $expiry = OrderService::periodExpiry($period, $start);
        $user->balance -= $payable;
        $user->expired_at = $expiry;
        $order->balance_amount = $payable;
        $order->total_amount = 0;
        OrderService::recordSubscriptionTerm($order, $start, $expiry, (int) $user->transfer_enable);
        if (!$user->save() || !$order->save()) throw new \RuntimeException('Automatic renewal could not be saved');
    }

    private function disable(User $user): void
    {
        $user->auto_renewal = 0;
        if (!$user->save()) throw new \RuntimeException('Automatic renewal preference could not be saved');
    }
}
