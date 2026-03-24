<?php

namespace App\Services;

use App\Jobs\OrderHandleJob;
use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use App\Services\QuotaPackageService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class OrderService
{
    CONST STR_TO_TIME = [
        'month_price' => 1,
        'quarter_price' => 3,
        'half_year_price' => 6,
        'year_price' => 12,
        'two_year_price' => 24,
        'three_year_price' => 36
    ];

    public $order;
    public $user;

    public function __construct(Order $order)
    {
        $this->order = $order;
    }

    public function open()
    {
        $order = $this->order;
        if (!Order::isValidType((int) $order->type)) {
            abort(500, '订单类型异常');
        }
        $this->user = User::find($order->user_id);
        if ((int) $order->type === Order::TYPE_DEPOSIT) {
            DB::beginTransaction();
            $userService = new UserService();
            if (!$userService->addBalance($order->user_id, $order->total_amount + $this->getbounus($order->total_amount), $order->pricing_currency ?? 'CNY')) {
                DB::rollBack();
                abort(500, '充值失败');
            }
            $order->status = 3;
            if (!$order->save()) {
                DB::rollBack();
                abort(500, '充值失败');
            }
            $this->grantPointsForOrder($order);
            DB::commit();
            return;
        }

        $plan = Plan::find($order->plan_id);

        if ($order->refund_amount) {
            $userService = new UserService();
            if (!$userService->addBalance($order->user_id, $order->refund_amount, $order->pricing_currency ?? 'CNY')) {
                abort(500, '开通失败');
            }
            $this->user = User::find($order->user_id);
        }
        DB::beginTransaction();
        if ($order->surplus_order_ids && is_array($order->surplus_order_ids)) {
            try {
                $surplusOrderIds = array_values(array_filter($order->surplus_order_ids, function ($item) {
                    return is_numeric($item);
                }));
                if (!empty($surplusOrderIds)) {
                    Order::whereIn('id', $surplusOrderIds)->update([
                        'status' => 4
                    ]);
                }
            } catch (\Exception $e) {
                DB::rollback();
                abort(500, '开通失败');
            }
        }
        switch ((string)$order->period) {
            case 'onetime_price':
                $this->buyByOneTime($order, $plan);
                break;
            case 'reset_price':
                $this->buyByResetTraffic();
                break;
            default:
                $downgradeAppliedNow = true;
                if ((int) $order->type === Order::TYPE_DOWNGRADE) {
                    $downgradeAppliedNow = $this->scheduleDowngrade($order);
                } else {
                    $this->buyByPeriod($order, $plan);
                }
        }

        switch ((int)$order->type) {
            case Order::TYPE_DOWNGRADE:
                $this->openEvent(config('v2board.change_order_event_id', 0));
                break;
            case Order::TYPE_NEW:
                $this->openEvent(config('v2board.new_order_event_id', 0));
                break;
            case Order::TYPE_RENEW:
                $this->openEvent(config('v2board.renew_order_event_id', 0));
                break;
            case Order::TYPE_UPGRADE:
                $this->openEvent(config('v2board.change_order_event_id', 0));
                break;
        }

        if ((int) $order->type !== Order::TYPE_DOWNGRADE || ($downgradeAppliedNow ?? true)) {
            $this->setSpeedLimit($plan->speed_limit);
        }

        if (!$this->user->save()) {
            DB::rollBack();
            abort(500, '开通失败');
        }
        $order->status = 3;
        if (!$order->save()) {
            DB::rollBack();
            abort(500, '开通失败');
        }

        $this->grantPointsForOrder($order);
        DB::commit();
    }


    public function setOrderType(User $user)
    {
        $order = $this->order;
        $order->change_direction = null;
        $order->change_apply_mode = null;
        $order->change_effective_at = null;
        $order->change_applied_at = null;
        if ($order->period === 'deposit'){
            $order->type = Order::TYPE_DEPOSIT;
        } else if ($order->period === 'reset_price') {
            $order->type = Order::TYPE_RESET;
        } else if ($user->plan_id !== NULL && $order->plan_id !== $user->plan_id && ($user->expired_at > time() || $user->expired_at === NULL)) {
            if (!(int)config('v2board.plan_change_enable', 1)) abort(500, '目前不允许更改订阅，请联系客服或提交工单操作');
            $changeDirection = $this->detectChangeDirection($user, $order);
            if ($changeDirection === Order::CHANGE_DIRECTION_DOWNGRADE) {
                $order->type = Order::TYPE_DOWNGRADE;
                $order->change_direction = Order::CHANGE_DIRECTION_DOWNGRADE;
                $order->change_apply_mode = Order::CHANGE_APPLY_NEXT_CYCLE;
                $order->change_effective_at = $user->expired_at;
            } else {
                $order->type = Order::TYPE_UPGRADE;
                $order->change_direction = $changeDirection;
                $order->change_apply_mode = Order::CHANGE_APPLY_IMMEDIATE;
                if ((int)config('v2board.surplus_enable', 1)) $this->getSurplusValue($user, $order);
                if ($order->surplus_amount >= $order->total_amount) {
                    $order->refund_amount = $order->surplus_amount - $order->total_amount;
                    $order->total_amount = 0;
                } else {
                    $order->total_amount = $order->total_amount - $order->surplus_amount;
                }
            }
        } else if ($user->expired_at > time() && $order->plan_id == $user->plan_id) { // 用户订阅未过期且购买订阅与当前订阅相同 === 续费
            $order->type = Order::TYPE_RENEW;
        } else { // 新购
            $order->type = Order::TYPE_NEW;
        }
    }

    public function setVipDiscount(User $user)
    {
        $order = $this->order;
        $couponDiscountAmount = (int) ($order->coupon_discount_amount ?? 0);
        $vipDiscountAmount = 0;

        if ($user->discount) {
            $vipDiscountAmount = (int) round($order->total_amount * ($user->discount / 100));
        }

        $order->coupon_discount_amount = $couponDiscountAmount;
        $order->user_discount_amount = $vipDiscountAmount;
        $order->discount_amount = $couponDiscountAmount + $vipDiscountAmount;
        $order->total_amount = $order->total_amount - $order->discount_amount;
    }

    public function setInvite(User $user):void
    {
        $order = $this->order;
        if ($user->invite_user_id && ($order->total_amount <= 0)) return;
        $order->invite_user_id = $user->invite_user_id;
        $inviter = User::find($user->invite_user_id);
        if (!$inviter) return;
        $isCommission = false;
        switch ((int)$inviter->commission_type) {
            case 0:
                $commissionFirstTime = (int)config('v2board.commission_first_time_enable', 1);
                $isCommission = (!$commissionFirstTime || ($commissionFirstTime && !$this->haveValidOrder($user)));
                break;
            case Order::TYPE_NEW:
                $isCommission = true;
                break;
            case Order::TYPE_RENEW:
                $isCommission = !$this->haveValidOrder($user);
                break;
        }

        if (!$isCommission) return;
        $commissionBaseAmount = $this->getCommissionBaseAmountInBaseMinor($order);
        if ($inviter && $inviter->commission_rate) {
            $order->commission_balance = $commissionBaseAmount * ($inviter->commission_rate / 100);
        } else {
            $order->commission_balance = $commissionBaseAmount * (config('v2board.invite_commission', 10) / 100);
        }
    }

    private function getCommissionBaseAmountInBaseMinor(Order $order): int
    {
        $currencyRateService = new CurrencyRateService();
        $pricingCurrency = strtoupper($order->pricing_currency ?: 'CNY');
        $baseCurrency = $currencyRateService->getBusinessBaseCurrency();

        if ($pricingCurrency === $baseCurrency) {
            return (int)$order->total_amount;
        }

        try {
            return $currencyRateService->convertMinor((int)$order->total_amount, $pricingCurrency, $baseCurrency);
        } catch (\Throwable $e) {
            return (int)$order->total_amount;
        }
    }


    private function grantPointsForOrder(Order $order): void
    {
        if (!Schema::hasTable('v2_user_points') || !Schema::hasTable('v2_user_point_logs')) {
            return;
        }

        $points = $this->calculateRewardPointsByOrder($order);
        if ($points <= 0) {
            return;
        }

        $userId = (int) $order->user_id;
        $now = time();
        $logType = 'order_reward';
        $description = sprintf('Points reward for order %s', $order->trade_no);

        $alreadyRewarded = DB::table('v2_user_point_logs')
            ->where('user_id', $userId)
            ->where('type', $logType)
            ->where('description', $description)
            ->exists();
        if ($alreadyRewarded) {
            return;
        }

        $userPoints = DB::table('v2_user_points')->where('user_id', $userId)->first();
        if (!$userPoints) {
            DB::table('v2_user_points')->insert([
                'user_id' => $userId,
                'points' => 0,
                'tier_id' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $currentPoints = 0;
        } else {
            $currentPoints = (int) $userPoints->points;
        }

        $newPoints = $currentPoints + $points;
        $tierId = 1;
        if (Schema::hasTable('v2_tiers')) {
            $tier = DB::table('v2_tiers')
                ->where('points_required', '<=', $newPoints)
                ->orderBy('level', 'desc')
                ->first();
            if ($tier) {
                $tierId = (int) $tier->id;
            }
        }

        DB::table('v2_user_points')
            ->where('user_id', $userId)
            ->update([
                'points' => $newPoints,
                'tier_id' => $tierId,
                'updated_at' => $now,
            ]);

        DB::table('v2_user_point_logs')->insert([
            'user_id' => $userId,
            'points' => $points,
            'type' => $logType,
            'description' => $description,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function calculateRewardPointsByOrder(Order $order): int
    {
        $amountMinor = (int) $order->total_amount;
        if ($amountMinor <= 0) {
            return 0;
        }

        $currencyRateService = new CurrencyRateService();
        $pricingCurrency = strtoupper((string) ($order->pricing_currency ?: 'CNY'));

        if ($pricingCurrency === 'USD') {
            return max($amountMinor, 0);
        }

        try {
            $usdMinor = $currencyRateService->convertMinor($amountMinor, $pricingCurrency, 'USD');
            return max((int) $usdMinor, 0);
        } catch (\Throwable $e) {
            return 0;
        }
    }


    private function haveValidOrder(User $user)
    {
        return Order::where('user_id', $user->id)
            ->whereNotIn('status', [0, 2])
            ->first();
    }

    private function getSurplusValue(User $user, Order $order)
    {
        if ($user->expired_at === NULL) {
            $this->getSurplusValueByOneTime($user, $order);
        } else {
            $this->getSurplusValueByPeriod($user, $order);
        }
    }


    private function getSurplusValueByOneTime(User $user, Order $order)
    {
        $lastOneTimeOrder = Order::where('user_id', $user->id)
            ->where('period', 'onetime_price')
            ->where('status', 3)
            ->orderBy('id', 'DESC')
            ->first();
        if (!$lastOneTimeOrder) return;
        $nowUserTraffic = $user->transfer_enable / 1073741824;
        if ($nowUserTraffic == 0) return;
        $targetCurrency = strtoupper((string)($order->pricing_currency ?: 'CNY'));
        $sourceCurrency = strtoupper((string)$lastOneTimeOrder->pricing_currency);
        if (empty($sourceCurrency)) return;
        $paidTotalAmount = (int)($lastOneTimeOrder->total_amount + $lastOneTimeOrder->balance_amount);
        $currencyRateService = new CurrencyRateService();
        if ($sourceCurrency !== $targetCurrency) {
            $paidTotalAmount = $currencyRateService->convertMinor($paidTotalAmount, $sourceCurrency, $targetCurrency);
        }
        if ($paidTotalAmount == 0) return;
        $notUsedTraffic = $nowUserTraffic - (($user->u + $user->d) / 1073741824);
        $remainingTrafficRatio = $notUsedTraffic / $nowUserTraffic;
        $result = $remainingTrafficRatio * $paidTotalAmount;
        $order->surplus_amount = max($result, 0);
        $orderModel = Order::where('user_id', $user->id)->where('period', '!=', 'reset_price')->where('status', 3);
        $order->surplus_order_ids = array_column($orderModel->get()->toArray(), 'id');
    }

    private function getSurplusValueByPeriod(User $user, Order $order)
    {
        $orders = Order::where('user_id', $user->id)
            ->where('period', '!=', 'reset_price')
            ->where('period', '!=', 'onetime_price')
            ->where('period', '!=', 'deposit')
            ->where('status', 3)
            ->get()
            ->toArray();
        if (!$orders) return;
        $orderAmountSum = 0;
        $orderMonthSum = 0;
        $lastValidateAt = null;
        $targetCurrency = strtoupper((string)($order->pricing_currency ?: 'CNY'));
        $currencyRateService = new CurrencyRateService();
        foreach ($orders as $item) {
            $period = self::STR_TO_TIME[$item['period']];
            $orderEndTime = strtotime("+{$period} month", $item['created_at']);
            if ($orderEndTime < time()) continue;
            $sourceCurrency = strtoupper((string)($item['pricing_currency'] ?? ''));
            if (empty($sourceCurrency)) continue;
            $lastValidateAt = $item['created_at'] > $lastValidateAt ? $item['created_at'] : $lastValidateAt;
            $orderMonthSum += $period;
            $itemAmount = (int)($item['total_amount'] + $item['balance_amount'] + $item['surplus_amount'] - $item['refund_amount']);
            if ($sourceCurrency !== $targetCurrency) {
                $itemAmount = $currencyRateService->convertMinor($itemAmount, $sourceCurrency, $targetCurrency);
            }
            $orderAmountSum += $itemAmount;
        }
        if ($lastValidateAt === null) return;
    
        $expiredAtByOrder = strtotime("+{$orderMonthSum} month", $lastValidateAt);
        $expiredAtByUser = $user->expired_at;
        if ($expiredAtByOrder < time() || $expiredAtByUser < time()) return;
        $orderSurplusSecond = $expiredAtByUser - time();
        $orderRangeSecond = $expiredAtByOrder - $lastValidateAt;
    
        $totalTraffic = $user->transfer_enable;
        $usedTraffic = ($user->u + $user->d);
        if ($totalTraffic == 0) return;
    
        $remainingTrafficRatio = ($totalTraffic - $usedTraffic) / $totalTraffic;
    
        $avgPricePerSecond = $orderAmountSum / $orderRangeSecond;
        if ($orderRangeSecond <= 31 * 86400) {
            $remainingExpiredTimeRatio = $orderSurplusSecond / $orderRangeSecond;
            $surplusRatio = min($remainingExpiredTimeRatio, $remainingTrafficRatio);
            $orderSurplusAmount = $avgPricePerSecond * $orderSurplusSecond * $surplusRatio;
        } else {
            $monthSeconds = 30 * 86400;
            $firstMonthRemainSeconds = $orderSurplusSecond % $monthSeconds;
            $surplusRatio = min($firstMonthRemainSeconds / $monthSeconds, $remainingTrafficRatio);
            $laterMonthsSeconds = $orderSurplusSecond - $firstMonthRemainSeconds;
            $orderSurplusAmount = $avgPricePerSecond * $monthSeconds * $surplusRatio +
                                  $avgPricePerSecond * $laterMonthsSeconds;
        }
    
        $order->surplus_amount = max($orderSurplusAmount, 0);
        $order->surplus_order_ids = array_column($orders, 'id');
    }

    public function paid(string $callbackNo)
    {
        $order = $this->order;
        if ($order->status !== 0) return true;
        $order->status = 1;
        $order->paid_at = time();
        $order->callback_no = $callbackNo;
        if (!$order->save()) return false;
        try {
            OrderHandleJob::dispatch($order->trade_no);
        } catch (\Exception $e) {
            return false;
        }
        return true;
    }

    public function cancel():bool
    {
        $order = $this->order;
        DB::beginTransaction();
        $order->status = 2;
        if (!$order->save()) {
            DB::rollBack();
            return false;
        }
        if ($order->balance_amount) {
            $userService = new UserService();
            if (!$userService->addBalance($order->user_id, $order->balance_amount, $order->pricing_currency ?? 'CNY')) {
                DB::rollBack();
                return false;
            }
        }
        DB::commit();
        return true;
    }

    private function setSpeedLimit($speedLimit)
    {
        $this->user->speed_limit = $speedLimit;
    }

    private function buyByResetTraffic()
    {
        $this->user->u = 0;
        $this->user->d = 0;
    }

    private function buyByPeriod(Order $order, Plan $plan)
    {
        // change plan process
        if ((int)$order->type === Order::TYPE_UPGRADE) {
            $this->user->expired_at = time();
        }
        $this->user->transfer_enable = $plan->transfer_enable * 1073741824;
        $this->user->device_limit = $plan->device_limit;
        // 从一次性转换到循环
        if ($this->user->expired_at === NULL) $this->buyByResetTraffic();
        // 新购
        if ($order->type === Order::TYPE_NEW) $this->buyByResetTraffic();

        // 到期当天续费刷新流量
        $expireDay = date('d', $this->user->expired_at);
        $expireMonth = date('m', $this->user->expired_at);
        $today = date('d');
        $currentMonth = date('m');
        if ($order->type === Order::TYPE_RENEW && $expireMonth == $currentMonth && $expireDay === $today ) {
            $this->buyByResetTraffic();
        }

        $this->user->plan_id = $plan->id;
        $this->user->group_id = $plan->group_id;
        $this->user->expired_at = $this->getTime($order->period, $this->user->expired_at);

        (new QuotaPackageService())->syncUserTransferEnable($this->user);
    }

    private function buyByOneTime(Order $order, Plan $plan)
    {
        // 对齐 Codex：额度包必须依附有效月度订阅，禁止仅买额度包。
        if ($this->user->plan_id === NULL || ($this->user->expired_at !== NULL && $this->user->expired_at <= time())) {
            abort(500, '购买额度包前需要先开通有效的月度订阅');
        }

        $packageBytes = max((int) $plan->transfer_enable, 0) * 1073741824;
        $quotaService = new QuotaPackageService();
        $quotaService->grantByOnetimeOrder($this->user, $packageBytes, $order->id, $plan->id);
        $quotaService->syncUserTransferEnable($this->user);
    }

    private function getTime($str, $timestamp)
    {
        if ($timestamp < time()) {
            $timestamp = time();
        }
        switch ($str) {
            case 'month_price':
                return strtotime('+1 month', $timestamp);
            case 'quarter_price':
                return strtotime('+3 month', $timestamp);
            case 'half_year_price':
                return strtotime('+6 month', $timestamp);
            case 'year_price':
                return strtotime('+12 month', $timestamp);
            case 'two_year_price':
                return strtotime('+24 month', $timestamp);
            case 'three_year_price':
                return strtotime('+36 month', $timestamp);
        }
    }

    private function openEvent($eventId)
    {
        switch ((int) $eventId) {
            case 0:
                break;
            case Order::TYPE_NEW:
                $this->buyByResetTraffic();
                break;
        }
    }


    private function scheduleDowngrade(Order $order): bool
    {
        if ($this->user->expired_at === NULL) {
            $plan = Plan::find($order->plan_id);
            if ($plan) {
                $this->buyByPeriod($order, $plan);
                return true;
            }
            return false;
        }

        $order->change_direction = Order::CHANGE_DIRECTION_DOWNGRADE;
        $order->change_apply_mode = Order::CHANGE_APPLY_NEXT_CYCLE;
        $order->change_effective_at = $this->user->expired_at;
        $order->change_applied_at = null;

        return false;
    }

    private function detectChangeDirection(User $user, Order $order): int
    {
        $currentPlan = Plan::find($user->plan_id);
        $targetPlan = Plan::find($order->plan_id);

        if (!$currentPlan || !$targetPlan) {
            return Order::CHANGE_DIRECTION_UPGRADE;
        }

        $currentUnitPrice = $this->getMonthlyUnitPrice($currentPlan, $order->period);
        $targetUnitPrice = $this->getMonthlyUnitPrice($targetPlan, $order->period);

        if ($currentUnitPrice === null || $targetUnitPrice === null) {
            return Order::CHANGE_DIRECTION_UPGRADE;
        }

        if ($targetUnitPrice < $currentUnitPrice) {
            return Order::CHANGE_DIRECTION_DOWNGRADE;
        }

        if ($targetUnitPrice > $currentUnitPrice) {
            return Order::CHANGE_DIRECTION_UPGRADE;
        }

        return Order::CHANGE_DIRECTION_LATERAL;
    }

    private function getMonthlyUnitPrice(Plan $plan, string $period): ?float
    {
        $periodMonths = self::STR_TO_TIME[$period] ?? null;
        $periodPrice = $plan->{$period} ?? null;

        if (!$periodMonths || $periodPrice === null) {
            return null;
        }

        return (float) $periodPrice / $periodMonths;
    }

    private function getbounus($total_amount) {
        $deposit_bounus = config('v2board.deposit_bounus', []);
        if (empty($deposit_bounus) || $deposit_bounus[0] === null) {
            return 0;
        }
        $add = 0;
        foreach ($deposit_bounus as $tier) {
            list($amount, $bounus) = explode(':', $tier);
            $amount = (float)$amount * 100;
            $bounus = (float)$bounus * 100;
            $amount = (int)$amount;
            $bounus = (int)$bounus;
            if ($total_amount >= $amount) {
                $add = max($add, $bounus);
            }
        }
        return $add;
    }
}
