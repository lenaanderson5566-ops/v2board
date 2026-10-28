<?php

namespace App\Services\Actions\User;


use App\Models\Plan;
use App\Models\User;
use App\Services\PlanService;
use App\Services\PlanTranslationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanActions
{
    public function credits(Request $request)
    {
        $plans = Plan::where('show', 1)->where('transfer_enable', '>', 0)
            ->whereNotNull('group_id')->orderBy('sort')->get();
        $user = User::findOrFail($request->user['id']);
        $counts = PlanService::countActiveUsers();
        $plans = $plans->filter(function ($plan) use ($user, $counts) {
            return $user->plan_id === $plan->id || $plan->capacity_limit === null
                || $plan->capacity_limit > ($counts[$plan->id]->count ?? 0);
        })->values();
        (new PlanTranslationService())->translateCollection($plans, app()->getLocale());
        foreach ($plans as $plan) \App\Services\BillingCurrency::present($plan, \App\Services\BillingCurrency::account($user));
        return response(['data' => $plans->filter(fn($plan)=>$plan->onetime_price !== null)->values()->map(function ($plan) {
            return ['id' => $plan->id, 'name' => $plan->name, 'bytes' => (int)round($plan->transfer_enable * 1073741824),
                'price' => $plan->onetime_price, 'currency'=>$plan->currency];
        })]);
    }

    public function fetch(Request $request)
    {
        $user = User::find($request->user['id']);
        $renewalOnly = !(int) config('v2board.plan_change_enable', 1)
            && $user->transfer_enable > 0 && $user->plan_id !== null
            && ($user->expired_at === null || $user->expired_at > time());
        if ($request->input('id')) {
            if ($renewalOnly && (int) $request->input('id') !== (int) $user->plan_id) {
                abort(409, __('Subscription plan does not exist'));
            }
            $plan = Plan::where('id', $request->input('id'))->first();
            if (!$plan) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
            }
            if ((!$plan->show && !$plan->renew) || (!$plan->show && $user->plan_id !== $plan->id)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
            }
            $translationService = new PlanTranslationService();
            $translationService->translateSingle($plan, app()->getLocale());
            \App\Services\BillingCurrency::present($plan, \App\Services\BillingCurrency::account($user));

            return response([
                'data' => $plan
            ]);
        }

        $counts = PlanService::countActiveUsers();
        $plans = Plan::query()
            ->when($renewalOnly,
                fn($query) => $query->where('id', $user->plan_id)->where(fn($visible) => $visible->where('show', 1)->orWhere('renew', 1)),
                fn($query) => $query->where('show', 1))
            ->orderBy('sort', 'ASC')
            ->get();
        foreach ($plans as $k => $v) {
            if ($plans[$k]->capacity_limit === NULL) continue;
            if (!isset($counts[$plans[$k]->id])) continue;
            $plans[$k]->capacity_limit = $plans[$k]->capacity_limit - $counts[$plans[$k]->id]->count;
        }
        $translationService = new PlanTranslationService();
        $translationService->translateCollection($plans, app()->getLocale());
        foreach ($plans as $plan) \App\Services\BillingCurrency::present($plan, \App\Services\BillingCurrency::account($user));
        $plans = $plans->filter(fn($plan)=>collect(array_keys(\App\Services\OrderService::STR_TO_TIME))->contains(fn($period)=>$plan->$period !== null))->values();

        return response([
            'data' => $plans
        ]);
    }
}
