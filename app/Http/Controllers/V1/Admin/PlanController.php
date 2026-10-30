<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\PlanSave;
use App\Http\Requests\Admin\PlanSort;
use App\Http\Requests\Admin\PlanUpdate;
use App\Models\Order;
use App\Models\Plan;
use App\Models\PlanTranslation;
use App\Models\User;
use App\Services\PlanService;
use App\Services\PlanTranslationState;
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
        $request->validate(['id'=>'required|integer|min:1']);
        $plan = Plan::findOrFail($request->input('id'));
        if (Order::where('plan_id', $request->input('id'))->first()) {
            abort(500, '该订阅下存在订单无法删除');
        }
        if (User::where('plan_id', $request->input('id'))->first()) {
            abort(500, '该订阅下存在用户无法删除');
        }
        return response([
            'data' => $plan->delete()
        ]);
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
