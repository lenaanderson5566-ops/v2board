<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class PlanService
{
    public $plan;

    public function __construct(int $planId)
    {
        $this->plan = Plan::find($planId);
    }

    public static function visibleToSubscriber(Plan $plan, User $user): bool
    {
        return (bool)$plan->show || ($plan->renew && (int)$user->plan_id === (int)$plan->id
            && TrafficCreditService::hasPeriod($user));
    }

    public function haveCapacity(User $user, ?int $replacingOrderId = null): bool
    {
        if ($this->plan->capacity_limit === NULL) return true;
        $planId = (int)$this->plan->id;
        if (self::occupiesSeat($user, $planId)) return true;
        return $this->plan->capacity_limit > (self::countOccupiedSeats($planId, $replacingOrderId)[$planId]->count ?? 0);
    }

    public static function occupiesSeat(User $user, int $planId): bool
    {
        return (int)$user->plan_id === $planId && ($user->expired_at === null
            || $user->expired_at > time() || $user->credit_balance > 0);
    }

    // A committed order holds its seat until cancellation or fulfillment. UNION
    // counts a renewal and its existing subscription as one seat for that plan.
    public static function countOccupiedSeats(?int $planId = null, ?int $replacingOrderId = null)
    {
        $assigned = User::query()->selectRaw('plan_id, id AS user_id')
            ->whereNotNull('plan_id')
            ->when($planId !== null, fn($q) => $q->where('plan_id', $planId))
            ->where(function ($q) {
                $q->whereRaw(CreditExpiryService::usableSql().' > 0')->orWhereNull('expired_at')
                    ->orWhere('expired_at', '>', time());
            });
        $reserved = Order::query()->select('plan_id', 'user_id')
            ->whereIn('status', [0, 1])->whereNull('credit_bytes')
            ->whereIn('period', [...array_keys(OrderService::STR_TO_TIME), 'onetime_price'])
            ->when($planId !== null, fn($q) => $q->where('plan_id', $planId))
            ->when($replacingOrderId !== null, fn($q) => $q->where('id', '!=', $replacingOrderId));
        return DB::query()->fromSub($assigned->union($reserved), 'plan_seats')
            ->selectRaw('plan_id, COUNT(*) AS count')->groupBy('plan_id')->get()->keyBy('plan_id');
    }

    public static function countActiveUsers()
    {
        return User::select(
            DB::raw("plan_id"),
            DB::raw("count(*) as count")
        )
            ->where('plan_id', '!=', NULL)
            ->where(function ($query) {
                $query->whereRaw(CreditExpiryService::usableSql().' > 0')->orWhere('expired_at', '>=', time())
                    ->orWhere('expired_at', NULL);
            })
            ->groupBy("plan_id")
            ->get()
            ->keyBy('plan_id');
    }
}
