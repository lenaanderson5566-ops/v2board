<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\PlanSave;
use App\Http\Requests\Admin\PlanSort;
use App\Http\Requests\Admin\PlanUpdate;
use App\Models\Giftcard;
use App\Models\Order;
use App\Models\Plan;
use App\Models\PlanTranslation;
use App\Models\User;
use App\Services\PlanService;
use App\Services\PlanTranslationState;
use App\Support\SiteConfiguration;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanController extends Controller
{
    public function fetch(Request $request)
    {
        $counts = collect(PlanService::countActiveUsers())->keyBy('plan_id');
        $plans = Plan::orderBy('sort', 'ASC')->get();
        foreach ($plans as $k => $v) {
            $plans[$k]->count = (int)($counts->get($v->id)->count ?? 0);
        }
        return response([
            'data' => $plans
        ]);
    }

    public function save(PlanSave $request)
    {
        $params = $request->validated();
        if ($request->input('id')) {
            $plan = Plan::find($request->input('id'));
            if (!$plan) {
                abort(500, '该订阅不存在');
            }
            DB::beginTransaction();
            // update user group id and transfer
            try {
                $plan = Plan::where('id', $plan->id)->lockForUpdate()->firstOrFail();
                $hashes = PlanTranslationState::hashes($plan);
                $sourceChanged = false;
                foreach (['name', 'content'] as $field) {
                    if (!array_key_exists($field, $params) || (string) $params[$field] === (string) $plan->$field) continue;
                    $sourceChanged = true;
                    // Legacy translations remain unverified. Capture only the old source
                    // when it changes, so an edit can invalidate them without guessing
                    // whether they were correct when this feature was installed.
                    PlanTranslation::where('plan_id', $plan->id)
                        ->whereNull($field.'_source_hash')
                        ->whereNotNull($field)->where($field, '<>', '')
                        ->update([$field.'_source_hash' => $hashes[$field]]);
                }
                if ($request->input('force_update')) {
                    User::where('plan_id', $plan->id)->update([
                        'group_id' => $params['group_id'],
                        'device_limit' => $params['device_limit'],
                        'speed_limit' => $params['speed_limit']
                    ]);
                    User::where('plan_id', $plan->id)->where('transfer_enable', '>', 0)->update(['transfer_enable' => $params['transfer_enable'] * 1073741824]);
                }
                $plan->update($params);
            } catch (\Exception $e) {
                DB::rollBack();
                abort(500, '保存失败');
            }
            DB::commit();
            return response([
                'data' => true,
                'meta' => ['plan_id' => $plan->id, 'translation_source_changed' => $sourceChanged]
            ]);
        }
        $plan = Plan::create($params);
        if (!$plan) {
            abort(500, '创建失败');
        }
        return response([
            'data' => true,
            'meta' => ['plan_id' => $plan->id, 'translation_source_changed' => true]
        ]);
    }

    public function drop(Request $request)
    {
        $data = $request->validate(['id'=>'required|integer|min:1']);
        $deleted = SiteConfiguration::withWriteLock(fn () => DB::transaction(function () use ($data) {
            // Order creation and gift card issuance take the same plan lock before writing references.
            $plan = Plan::whereKey($data['id'])->lockForUpdate()->firstOrFail();
            $settings = SiteConfiguration::read();
            $trialPlan = (int) ($settings['try_out_plan_id'] ?? config('fastai.try_out_plan_id', 0));
            abort_if($trialPlan === $plan->id, 409, '该套餐正在用于注册试用，请先修改站点设置。');
            abort_if(Order::where('plan_id', $plan->id)->exists(), 409, '该套餐已有订单，无法删除。');
            abort_if(User::where('plan_id', $plan->id)->exists(), 409, '该套餐已有用户，无法删除。');

            $usableGiftcard = Giftcard::where('type', 5)->where('plan_id', $plan->id)
                ->where(fn ($cards) => $cards->whereNull('limit_use')->orWhere('limit_use', '>', 0))
                ->where(fn ($cards) => $cards->where('ended_at', 0)->orWhere('ended_at', '>=', time()))
                ->exists();
            abort_if($usableGiftcard, 409, '该套餐仍有可兑换的礼品卡，请先停止兑换。');
            return $plan->delete();
        }, 3));
        return response(['data' => $deleted]);
    }

    public function update(PlanUpdate $request)
    {
        $updateData = $request->only([
            'show',
            'renew'
        ]);

        $plan = Plan::find($request->input('id'));
        if (!$plan) {
            abort(500, '该订阅不存在');
        }

        try {
            $plan->update($updateData);
        } catch (\Exception $e) {
            abort(500, '保存失败');
        }

        return response([
            'data' => true
        ]);
    }

    public function sort(PlanSort $request)
    {
        \App\Services\AdminSortOrder::apply(Plan::class, $request->input('plan_ids'), true);
        return response([
            'data' => true
        ]);
    }
}
