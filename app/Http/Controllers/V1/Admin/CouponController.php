<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\CouponGenerate;
use App\Models\Coupon;
use App\Utils\Csv;
use App\Services\TimeZones;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CouponController extends Controller
{
    public function fetch(Request $request)
    {
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $sortType = in_array($request->input('sort_type'), ['ASC', 'DESC']) ? $request->input('sort_type') : 'DESC';
        $sort = $request->input('sort') ? $request->input('sort') : 'id';
        $builder = Coupon::orderBy($sort, $sortType);
        $total = $builder->count();
        $coupons = $builder->forPage($current, $pageSize)
            ->get();
        return response([
            'data' => $coupons,
            'total' => $total
        ]);
    }

    public function show(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(500, '参数有误');
        }
        $coupon = Coupon::find($request->input('id'));
        if (!$coupon) {
            abort(500, '优惠券不存在');
        }
        $coupon->show = $coupon->show ? 0 : 1;
        if (!$coupon->save()) {
            abort(500, '保存失败');
        }

        return response([
            'data' => true
        ]);
    }

    public function generate(CouponGenerate $request)
    {
        if ((int)$request->input('generate_count', 1) > 1) {
            return $this->multiGenerate($request);
        }

        $params = $request->validated();
        unset($params['id'], $params['generate_count'], $params['code'], $params['generate_codes'], $params['limit_use_with_user']);
        if (!$request->input('id')) {
            $params['code'] = ''; // Retained NOT NULL column; code redemption is retired.
            if (!Coupon::create($params)) {
                abort(500, '创建失败');
            }
        } else {
            DB::transaction(function () use ($request, $params) {
                $coupon = Coupon::whereKey($request->input('id'))->lockForUpdate()->firstOrFail();
                // Wallets, queued campaigns and orders retain their original snapshots.
                $coupon->update($params);
            }, 3);
        }

        return response([
            'data' => true
        ]);
    }

    private function multiGenerate(CouponGenerate $request)
    {
        $coupons = [];
        $coupon = $request->validated();
        $coupon['created_at'] = $coupon['updated_at'] = time();
        $coupon['show'] = 1;
        unset($coupon['id'], $coupon['generate_count'], $coupon['generate_codes'], $coupon['limit_use_with_user']);
        for ($i = 0;$i < $request->input('generate_count');$i++) {
            $coupon['code'] = '';
            array_push($coupons, $coupon);
        }
        DB::beginTransaction();
        if (!Coupon::insert(array_map(function ($item) use ($coupon) {
            // format data
            if (isset($item['limit_plan_ids']) && is_array($item['limit_plan_ids'])) {
                $item['limit_plan_ids'] = json_encode($coupon['limit_plan_ids']);
            }
            if (isset($item['limit_period']) && is_array($item['limit_period'])) {
                $item['limit_period'] = json_encode($coupon['limit_period']);
            }
            return $item;
        }, $coupons))) {
            DB::rollBack();
            abort(500, '生成失败');
        }
        DB::commit();
        $rows = [];
        foreach($coupons as $coupon) {
            $type = ['', '金额 (CNY)', '比例'][$coupon['type']];
            $value = ['', ($coupon['value'] / 100),$coupon['value']][$coupon['type']];
            $startTime = TimeZones::iso8601($coupon['started_at'] ?: null);
            $endTime = TimeZones::iso8601($coupon['ended_at'] ?: null);
            $limitUse = $coupon['limit_use'] ?? '不限制';
            $createTime = TimeZones::iso8601($coupon['created_at'] ?: null);
            $limitPlanIds = isset($coupon['limit_plan_ids']) ? implode("/", $coupon['limit_plan_ids']) : '不限制';
            $rows[] = [$coupon['name'], $type, $value, $startTime, $endTime, $limitUse, $limitPlanIds, $createTime];
        }
        if ($request->expectsJson() && $request->input('format') !== 'csv') return response(['data' => true, 'generated_count' => count($coupons)]);
        return Csv::response(['名称', '类型', '金额或比例', '开始时间', '结束时间', '可用次数', '可用于订阅', '生成时间'], $rows, 'coupons.csv');
    }

    public function drop(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(500, '参数有误');
        }
        $coupon = Coupon::find($request->input('id'));
        if (!$coupon) {
            abort(500, '优惠券不存在');
        }
        abort_if(DB::table('v2_coupon_wallet')->where('coupon_id', $coupon->id)->exists(), 409, '已有发放记录，请停用领券入口，保留历史记录。');
        abort_if(DB::table('v2_coupon_campaign')->where('coupon_id',$coupon->id)->where('status','queued')->exists(),409,'存在待发放批次，请先取消批次。');
        if (!$coupon->delete()) {
            abort(500, '删除失败');
        }

        return response([
            'data' => true
        ]);
    }
    public function issue(Request $request)
    {
        $values = $request->validate(['coupon_id'=>'required|integer|min:1','user_ids'=>'required|array|min:1|max:100','user_ids.*'=>'required|integer|min:1|distinct|exists:v2_user,id']);
        $ids = DB::transaction(function() use ($values, $request) {
            $result = [];
            $users = $values['user_ids']; sort($users, SORT_NUMERIC);
            foreach ($users as $id) $result[] = \App\Services\CouponWallet::issue((int)$id, (int)$values['coupon_id'], (int)$request->user['id']);
            return $result;
        }, 3);
        return response(['data'=>['issued'=>count($ids)]]);
    }
}
