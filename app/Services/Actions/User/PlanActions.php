<?php

namespace App\Services\Actions\User;


use App\Models\Plan;
use App\Models\User;
use App\Services\PlanService;
use App\Services\PlanTranslationService;
use App\Services\TrafficCreditService;
use Illuminate\Http\Request;

class PlanActions
{
    public function credits(Request $request)
    {
        $plans = Plan::where('show', 1)->where('transfer_enable', '>', 0)
            ->whereNotNull('group_id')->orderBy('sort')->get();
        $user = User::findOrFail($request->user['id']);
        $counts = PlanService::countOccupiedSeats();
        $plans = $plans->filter(function ($plan) use ($user, $counts) {
            return $plan->capacity_limit === null || $plan->capacity_limit > ($counts[$plan->id]->count ?? 0)
                || PlanService::occupiesSeat($user, (int)$plan->id);
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
        $currentPlan = TrafficCreditService::hasPeriod($user) ? $user->plan_id : null;
        $renewalOnly = $currentPlan !== null && !(int) config('fastai.plan_change_enable', 1);
        if ($request->input('id')) {
            if ($renewalOnly && (int) $request->input('id') !== (int) $user->plan_id) {
                abort(409, __('Subscription plan does not exist'));
            }
            $plan = Plan::where('id', $request->input('id'))->first();
            if (!$plan) {
                abort($request->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
            }
            if (!PlanService::visibleToSubscriber($plan, $user)) {
                abort($request->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
            }
            if ($plan->capacity_limit !== null) {
                $counts = PlanService::countOccupiedSeats((int)$plan->id);
                $plan->capacity_limit = max(0, $plan->capacity_limit - ($counts[$plan->id]->count ?? 0));
            }
            $translationService = new PlanTranslationService();
            $translationService->translateSingle($plan, app()->getLocale());
            \App\Services\BillingCurrency::present($plan, \App\Services\BillingCurrency::account($user));

            return response([
                'data' => $plan
            ]);
        }

        $plans = Plan::query()
            ->when($renewalOnly, fn($query) => $query->where('id', $currentPlan))
            ->where(function ($query) use ($currentPlan) {
                $query->where('show', 1);
                if ($currentPlan !== null) {
                    $query->orWhere(fn($renewal) => $renewal->where('id', $currentPlan)->where('renew', 1));
                }
            })
            ->orderBy('sort', 'ASC')
            ->get();
        $counts = $plans->contains(fn($plan) => $plan->capacity_limit !== null) ? PlanService::countOccupiedSeats() : [];
        foreach ($plans as $k => $v) {
            if ($plans[$k]->capacity_limit === NULL) continue;
            $plans[$k]->capacity_limit = max(0, $plans[$k]->capacity_limit - ($counts[$plans[$k]->id]->count ?? 0));
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
