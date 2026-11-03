<?php

namespace App\Services;

use App\Jobs\OrderHandleJob;
use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Support\Facades\DB;

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
        DB::transaction(function () {
            $this->user = User::whereKey($this->order->user_id)->lockForUpdate()->firstOrFail();
            $this->order = Order::where('id', $this->order->id)->lockForUpdate()->firstOrFail();
            if ((int)$this->order->status !== 1) return;
            $this->openLocked();
            if ((int)$this->order->status === 3 && $this->order->credit_bytes === null
                && $this->order->period !== 'reset_price' && in_array((int)$this->order->type, [1, 2, 3], true)) {
                ServiceNotification::schedule($this->user, (int)$this->order->type === 2);
            }
        }, 3);
    }

    private function openLocked()
    {
        $order = $this->order;
        if ($order->credit_bytes !== null) {
            (new TrafficCreditService())->fulfill($order);
            return;
        }
        if (BillingCurrency::account($this->user) !== ($order->currency ?: 'CNY')) throw new \RuntimeException('Order wallet currency mismatch');
        if ($order->type == 9) {
            $this->user->balance += $order->total_amount + (($order->currency ?: 'CNY') === 'CNY' ? $this->getbounus($order->total_amount) : 0);

            if (!$this->user->save()) {
                abort(500, '充值失败');
            }
            $order->status = 3;
            if (!$order->save()) {
                abort(500, '充值失败');
            }
            return;
        }

        $plan = Plan::find($order->plan_id);

        if ($order->refund_amount) {
            $this->user->balance = $this->user->balance + $order->refund_amount;
        }
        if ($order->surplus_order_ids) {
            $periods = $this->user->expired_at === null ? ['onetime_price'] : array_keys(self::STR_TO_TIME);
            $this->paidSurplusSources($this->user, $periods)
                ->where('id', '<', $order->id)
                ->where('paid_at', '<=', $order->created_at)
                ->whereIn('id', $order->surplus_order_ids)
                ->whereRaw('COALESCE(total_amount, 0) + COALESCE(balance_amount, 0) > 0')
                ->update(['status' => 4]);
        }
        switch ((string)$order->period) {
            case 'onetime_price':
                $this->buyByOneTime($order, $plan);
                break;
            case 'reset_price':
                $this->buyByResetTraffic();
                $resetAt = time();
                if ((int)$this->user->plan_id === (int)$order->plan_id && $this->user->expired_at > $resetAt) {
                    $this->user->traffic_reset_anchor_at = $resetAt;
                }
                break;
            default:
                $this->buyByPeriod($order, $plan);
        }

        switch ((int)$order->type) {
            case 1:
                $this->openEvent(config('fastai.new_order_event_id', 0));
                break;
            case 2:
                $this->openEvent(config('fastai.renew_order_event_id', 0));
                break;
            case 3:
                $this->openEvent(config('fastai.change_order_event_id', 0));
                break;
        }

        $this->setSpeedLimit($plan->speed_limit);

        if (!$this->user->save()) {
            abort(500, '开通失败');
        }
        $order->status = 3;
        if (!$order->save()) {
            abort(500, '开通失败');
        }
        // An old permanent-plan reset must restore its promised allowance before conversion.
        (new TrafficCreditService())->migrateUser($this->user);
        if (!$this->user->save()) abort(500, '开通失败');
    }


    public function setOrderType(User $user)
    {
        $order = $this->order;
        if ($order->period === 'deposit'){
            $order->type = 9;
        } else if ($order->credit_bytes !== null) {
            $order->type = 5;
        } else if ($order->period === 'reset_price') {
            $order->type = 4;
        } else if ($user->transfer_enable > 0 && $user->plan_id !== NULL && $order->plan_id !== $user->plan_id && ($user->expired_at > time() || $user->expired_at === NULL)) {
            if (!(int)config('fastai.plan_change_enable', 1)) abort(500, '目前不允许更改订阅，请联系客服或提交工单操作');
            $order->type = 3;
            if ((int)config('fastai.surplus_enable', 1)) {
                [$order->surplus_amount, $order->surplus_order_ids] = $this->surplusValue($user, $order->created_at ?? time());
            }
            if ($order->surplus_amount >= $order->total_amount) {
                $order->refund_amount = $order->surplus_amount - $order->total_amount;
                $order->total_amount = 0;
            } else {
                $order->total_amount = $order->total_amount - $order->surplus_amount;
            }
        } else if ($user->expired_at > time() && $order->plan_id == $user->plan_id) { // 用户订阅未过期且购买订阅与当前订阅相同 === 续费
            $order->type = 2;
        } else { // 新购
            $order->type = 1;
        }
    }

    public function setVipDiscount(User $user)
    {
        $order = $this->order;
        if ($user->discount) {
            $order->discount_amount = $order->discount_amount + ($order->total_amount * ($user->discount / 100));
        }
        // Preserve historical CNY payable rounding while storing consistent integer totals.
        $payable = (int)round(max(0, $order->total_amount - $order->discount_amount));
        $order->discount_amount = (int)$order->total_amount - $payable;
        $order->total_amount = $payable;
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
                $commissionFirstTime = (int)config('fastai.commission_first_time_enable', 1);
                $isCommission = (!$commissionFirstTime || ($commissionFirstTime && !$this->haveValidOrder($user)));
                break;
            case 1:
                $isCommission = true;
                break;
            case 2:
                $isCommission = !$this->haveValidOrder($user);
                break;
        }

        if (!$isCommission) return;
        $cursor = $inviter; $visited = [];
        $levels = (int)config('fastai.commission_distribution_enable', 0) ? 3 : 1;
        for ($level=0; $cursor && $level<$levels; $level++) {
            if (in_array($cursor->id, $visited, true)) break;
            $visited[] = $cursor->id;
            if (BillingCurrency::account($cursor) !== ($order->currency ?: 'CNY')) $order->fx_snapshot = ExchangeRate::snapshot();
            $cursor = User::find($cursor->invite_user_id);
        }
        if ($inviter && $inviter->commission_rate) {
            $order->commission_balance = $order->total_amount * ($inviter->commission_rate / 100);
        } else {
            $order->commission_balance = $order->total_amount * (config('fastai.invite_commission', 10) / 100);
        }
    }

    private function haveValidOrder(User $user)
    {
        return Order::where('user_id', $user->id)
            ->whereNotIn('status', [0, 2])
            ->first();
    }

    public function isSurplusQuoteCurrent(User $user): bool
    {
        $order = $this->order;
        if (!(int) config('fastai.plan_change_enable', 1) || !(int) config('fastai.surplus_enable', 1)
            || (int) $order->type !== 3 || (int) $order->user_id !== (int) $user->id
            || (int) $order->plan_id === (int) $user->plan_id || !TrafficCreditService::hasPeriod($user)
            || BillingCurrency::account($user) !== ($order->currency ?: 'CNY') || !$order->created_at) {
            return false;
        }

        [$amount, $ids] = $this->surplusValue($user, $order->created_at);

        return $amount > 0 && $amount === (int) $order->surplus_amount
            && $ids === array_map('intval', $order->surplus_order_ids ?? []);
    }

    private function paidSurplusSources(User $user, array $periods): \Illuminate\Database\Eloquent\Builder
    {
        return Order::query()
            ->where('user_id', $user->id)
            ->where('plan_id', $user->plan_id)
            ->where('currency', BillingCurrency::account($user))
            ->where('status', 3)
            ->where('paid_at', '>', 0)
            ->whereNull('credit_bytes')
            ->whereIn('type', [1, 2, 3])
            ->whereIn('period', $periods);
    }

    public static function recordSubscriptionTerm(Order $order, int $start, int $end, int $quota): void
    {
        $snapshot = $order->payment_snapshot ?? [];
        $snapshot['subscription_term'] = ['starts_at' => $start, 'ends_at' => $end, 'quota_bytes' => $quota];
        $order->payment_snapshot = $snapshot;
    }

    private function surplusValue(User $user, int $at): array
    {
        $quota = (int) $user->transfer_enable;
        if ($quota <= 0 || ($user->expired_at !== null && $user->expired_at <= $at)) return [0, []];

        $traffic = min(1, max(0, ($quota - (int) $user->u - (int) $user->d) / $quota));
        if ($user->expired_at === null) {
            $source = $this->paidSurplusSources($user, ['onetime_price'])
                ->where('paid_at', '<=', $at)->orderByDesc('paid_at')->orderByDesc('id')->first();
            if (!$source) return [0, []];
            $amount = (int) floor($traffic * max(0, (int) $source->total_amount + (int) $source->balance_amount));

            return [$amount, $amount > 0 ? [(int) $source->id] : []];
        }

        $sources = $this->paidSurplusSources($user, array_keys(self::STR_TO_TIME))
            ->where('paid_at', '<=', $at)->orderBy('paid_at')->orderBy('id')->get();
        $end = 0;
        $terms = [];
        foreach ($sources as $source) {
            // Renewals extend the provable paid timeline. New activations replace it.
            if ((int) $source->type !== 2) {
                $end = 0;
                $terms = [];
            }
            $term = $source->payment_snapshot['subscription_term'] ?? null;
            $termQuota = $quota;
            if ($term !== null) {
                $start = $term['starts_at'] ?? null;
                $stop = $term['ends_at'] ?? null;
                $snapshotQuota = $term['quota_bytes'] ?? null;
                if (!is_int($start) || $start < (int) $source->paid_at || !is_int($stop) || $stop <= $start
                    || !is_int($snapshotQuota) || $snapshotQuota <= 0) continue;
                $end = $stop;
                $termQuota = min($quota, $snapshotQuota);
            } else {
                $start = max($end, (int) $source->paid_at);
                $end = self::periodExpiry($source->period, $start);
            }
            $terms[] = [$source, $start, $end, $termQuota];
        }

        $amount = 0;
        $ids = [];
        $nextStart = (int) $user->expired_at;
        foreach (array_reverse($terms) as [$source, $start, $end, $termQuota]) {
            // Exact later activations also cap any overlapping legacy estimate.
            $remaining = min($end, $nextStart) - max($start, $at);
            $nextStart = min($nextStart, $start);
            if ($remaining <= 0) continue;

            // Unrecorded gifts and manual extensions add no paid time or money.
            // Only funds applied to this order are directly traceable on historical rows.
            $funded = max(0, (int) $source->total_amount + (int) $source->balance_amount);
            $unusedQuota = min(1, max(0, ($termQuota - (int) $user->u - (int) $user->d) / $termQuota));
            $ratio = min($remaining / ($end - $start), $start <= $at ? $unusedQuota : 1);
            $value = (int) floor($funded * $ratio);
            if ($value <= 0) continue;

            $amount += $value;
            $ids[] = (int) $source->id;
        }

        return [min($amount, 2147483647), array_reverse($ids)];
    }

    public function paid(string $callbackNo, array $paymentContext = [], ?callable $beforeRecording = null)
    {
        $order = $this->order;
        // A stale simultaneous callback must never reopen a completed order.
        $record = function () use ($order, $callbackNo, $paymentContext, $beforeRecording) {
            if ($beforeRecording) $beforeRecording();
            return Order::where('id', $order->id)->where('status', 0)->update([
                'status' => 1, 'paid_at' => time(), 'callback_no' => $callbackNo,
            ] + $paymentContext);
        };
        $changed = $beforeRecording ? DB::transaction($record, 3) : $record();
        $order->refresh();
        if (!$changed && (int)$order->status !== 1) return true;
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
        return DB::transaction(function () use ($order) {
            $affected = Order::where('id', $order->id)->where('status', 0)->update(['status' => 2]);
            if ($affected !== 1) return false;
            $user = User::where('id', $order->user_id)->lockForUpdate()->firstOrFail();
            if (BillingCurrency::account($user) !== ($order->currency ?: 'CNY')) throw new \RuntimeException('Order wallet currency mismatch');
            DB::table('v2_coupon_wallet')->where('order_id', $order->id)->update(['order_id'=>null]);
            $user->balance += (int)$order->balance_amount;
            (new TrafficCreditService())->migrateUser($user);
            if (!$user->save()) throw new \RuntimeException('Order cancellation failed');
            return true;
        }, 3);
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
        $now = time();
        $type = (int)$order->type;
        $expiredAt = $this->user->expired_at;
        $expiredRenewal = $type === 2 && $expiredAt !== null && $expiredAt <= $now;
        if ($expiredRenewal || in_array($type, [1, 3], true)) {
            $this->user->traffic_reset_anchor_at = null;
        }
        // change plan process
        if ($type === 3) {
            $this->user->expired_at = $now;
        }
        $this->user->transfer_enable = $plan->transfer_enable * 1073741824;
        $this->user->device_limit = $plan->device_limit;
        // 从一次性转换到循环
        if ($this->user->expired_at === NULL) $this->buyByResetTraffic();
        // 新购
        if ($type === 1) $this->buyByResetTraffic();

        // An order created as a renewal may be fulfilled after the old term has ended.
        if ($type === 2 && $expiredAt !== null
            && ($expiredRenewal || date('Y-m-d', $expiredAt) === date('Y-m-d', $now))) {
            $this->buyByResetTraffic();
        }

        $this->user->plan_id = $plan->id;
        $this->user->group_id = $plan->group_id;
        $start = max($now, (int) $this->user->expired_at);
        $this->user->expired_at = self::periodExpiry($order->period, $start);
        self::recordSubscriptionTerm($order, $start, $this->user->expired_at, (int) $this->user->transfer_enable);
    }

    private function buyByOneTime(Order $order, Plan $plan)
    {
        $transfer_enable = $plan->transfer_enable;
        if (!$order->surplus_order_ids) {
            $notUsedTraffic = ($this->user->transfer_enable - ($this->user->u + $this->user->d)) / 1073741824;
            if ($notUsedTraffic > 0 && $this->user->expired_at == NULL) {
                $transfer_enable += $notUsedTraffic;
            }
        }
        $this->buyByResetTraffic();
        $this->user->transfer_enable = $transfer_enable * 1073741824;
        $this->user->device_limit = $plan->device_limit;
        $this->user->plan_id = $plan->id;
        $this->user->group_id = $plan->group_id;
        $this->user->expired_at = NULL;
        // Honor pending legacy orders' quoted conversion, then preserve it as credits.
        $remaining = max(0, $this->user->transfer_enable - $this->user->u - $this->user->d);
        DB::table('v2_traffic_credit_log')->insert([
            'user_id' => $this->user->id, 'reference' => 'order:'.$order->id,
            'bytes' => $remaining, 'kind' => 'legacy_order',
            'snapshot' => json_encode(['plan_id' => $plan->id]), 'created_at' => time(),
        ]);
        CreditExpiryService::grant($this->user, (int)$remaining, 'order:'.$order->id);
        $this->user->credit_migrated_at = time();
        $this->user->transfer_enable = 0;
    }

    public static function periodExpiry(string $period, int $start): int
    {
        $months = self::STR_TO_TIME[$period] ?? throw new \InvalidArgumentException('Invalid subscription period');
        $end = strtotime("+{$months} month", $start);
        if ($end === false || $end <= $start) throw new \RuntimeException('Invalid subscription expiry');
        return $end;
    }

    private function openEvent($eventId)
    {
        switch ((int) $eventId) {
            case 0:
                break;
            case 1:
                $this->buyByResetTraffic();
                break;
        }
    }

    private function getbounus($total_amount) {
        $deposit_bounus = config('fastai.deposit_bounus', []);
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
