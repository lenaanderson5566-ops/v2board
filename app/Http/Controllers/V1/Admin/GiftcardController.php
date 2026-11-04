<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\GiftcardGenerate;
use App\Models\Giftcard;
use App\Models\Plan;
use App\Utils\Helper;
use App\Utils\Csv;
use App\Services\TimeZones;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GiftcardController extends Controller
{
    public function fetch(Request $request)
    {
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $sortType = in_array($request->input('sort_type'), ['ASC', 'DESC']) ? $request->input('sort_type') : 'DESC';
        $sort = $request->input('sort', 'id');
        
        $builder = Giftcard::orderBy($sort, $sortType);
        $total = $builder->count();
        $giftcards = $builder->forPage($current, $pageSize)->get();

        return response([
            'data' => $giftcards,
            'total' => $total
        ]);
    }

    public function generate(GiftcardGenerate $request)
    {
        $params = $request->validated();
        $id = $params['id'] ?? null;
        $count = (int) ($params['generate_count'] ?? 0);
        unset($params['id'], $params['generate_count']);
        $params['plan_id'] = $params['plan_id'] ?? null;

        $giftcards = DB::transaction(function () use ($params, $id, $count) {
            if ((int) $params['type'] === 5) {
                abort_unless(Plan::whereKey($params['plan_id'])->sharedLock()->first(['id']), 409, '该套餐已被删除，请重新选择');
            }
            if ($count) return $this->multiGenerate($params, $count);

            if ($id === null) {
                $params['code'] ??= Helper::randomChar(16);
                abort_unless(Giftcard::create($params)->exists, 500, '礼品卡创建失败');
            } else {
                $giftcard = Giftcard::whereKey($id)->lockForUpdate()->first();
                abort_unless($giftcard, 404, '礼品卡不存在');
                // An omitted or empty code on edit keeps the distributed code.
                if (!isset($params['code'])) unset($params['code']);
                abort_unless($giftcard->update($params), 500, '礼品卡保存失败');
            }
            return [];
        }, 3);

        if ($count === 0) return response(['data' => true]);
        if ($request->expectsJson() && $request->input('format') !== 'csv') {
            return response(['data' => true, 'generated_count' => count($giftcards)]);
        }
        return $this->export($giftcards);
    }

    private function multiGenerate(array $giftcard, int $count): array
    {
        $giftcards = [];
        $giftcard['created_at'] = $giftcard['updated_at'] = time();

        for ($i = 0; $i < $count; $i++) {
            do {
                $giftcard['code'] = Helper::randomChar(16);
            } while (Giftcard::where('code', $giftcard['code'])->exists());
            $giftcards[] = $giftcard;
        }
        abort_unless(Giftcard::insert($giftcards), 500, '礼品卡批量生成失败');
        return $giftcards;
    }

    private function export(array $giftcards)
    {
        $rows = [];
        foreach ($giftcards as $giftcard) {
            $giftcardvalue = $giftcard['value'] ?? 0;
            $type = ['', '金额 (CNY)', '时长', '流量', '重置', '套餐'][$giftcard['type']];
            $value = ['', round($giftcardvalue/100, 2), $giftcardvalue . '天', $giftcardvalue . 'GB', '-', $giftcardvalue . '天'][$giftcard['type']];
            $startTime = TimeZones::iso8601($giftcard['started_at'] ?: null);
            $endTime = TimeZones::iso8601($giftcard['ended_at'] ?: null);
            $limitUse = $giftcard['limit_use'] ?? '不限制';
            $createTime = TimeZones::iso8601($giftcard['created_at'] ?: null);
            $rows[] = [$giftcard['name'], $type, $value, $startTime, $endTime, $limitUse, $giftcard['code'], $createTime];
        }

        return Csv::response(['名称', '类型', '数值', '开始时间', '结束时间', '可用次数', '礼品卡卡密', '生成时间'], $rows, 'giftcards.csv');
    }

    public function drop(Request $request)
    {
        $params = $request->validate(['id'=>'required|integer|min:1']);
        DB::transaction(function () use ($params) {
            $giftcard = Giftcard::whereKey($params['id'])->lockForUpdate()->firstOrFail();
            $used = $giftcard->used_user_ids;
            if (is_string($used)) $used = json_decode($used, true) ?? $used;
            abort_if(!empty($used), 409, '礼品卡已有兑换记录，请编辑结束时间以停止继续兑换。');
            abort_unless($giftcard->delete(), 500, '删除失败');
        }, 3);

        return response([
            'data' => true
        ]);
    }
}
