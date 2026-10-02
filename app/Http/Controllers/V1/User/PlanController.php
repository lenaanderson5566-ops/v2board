<?php

namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\User;
use App\Services\PlanService;
use App\Services\PlanTranslationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanController extends Controller
{
    public function credits(Request $request)
    {
        $plans = Plan::where('show', 1)->whereNotNull('onetime_price')->where('transfer_enable', '>', 0)
            ->whereNotNull('group_id')->orderBy('sort')->get();
        $user = User::findOrFail($request->user['id']);
        $counts = PlanService::countActiveUsers();
        $plans = $plans->filter(function ($plan) use ($user, $counts) {
            return $user->plan_id === $plan->id || $plan->capacity_limit === null
                || $plan->capacity_limit > ($counts[$plan->id]->count ?? 0);
        })->values();
        (new PlanTranslationService())->translateCollection($plans, app()->getLocale());
        return response(['data' => $plans->map(function ($plan) {
            return ['id' => $plan->id, 'name' => $plan->name, 'bytes' => (int)round($plan->transfer_enable * 1073741824),
                'price' => $plan->onetime_price];
        })]);
    }

    public function fetch(Request $request)
    {
        $user = User::find($request->user['id']);
        if ($request->input('id')) {
            $plan = Plan::where('id', $request->input('id'))->first();
            if (!$plan) {
                abort(500, __('Subscription plan does not exist'));
            }
            if ((!$plan->show && !$plan->renew) || (!$plan->show && $user->plan_id !== $plan->id)) {
                abort(500, __('Subscription plan does not exist'));
            }
            $translationService = new PlanTranslationService();
            $translationService->translateSingle($plan, app()->getLocale());

            return response([
                'data' => $plan
            ]);
        }

        $counts = PlanService::countActiveUsers();
        $plans = Plan::where('show', 1)->where(function ($q) {
            foreach (array_keys(\App\Services\OrderService::STR_TO_TIME) as $period) $q->orWhereNotNull($period);
        })
            ->orderBy('sort', 'ASC')
            ->get();
        foreach ($plans as $k => $v) {
            if ($plans[$k]->capacity_limit === NULL) continue;
            if (!isset($counts[$plans[$k]->id])) continue;
            $plans[$k]->capacity_limit = $plans[$k]->capacity_limit - $counts[$plans[$k]->id]->count;
        }
        $translationService = new PlanTranslationService();
        $translationService->translateCollection($plans, app()->getLocale());

        return response([
            'data' => $plans
        ]);
    }
}
