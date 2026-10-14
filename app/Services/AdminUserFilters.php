<?php

namespace App\Services;

use App\Http\Requests\Admin\UserFetch;
use App\Models\User;
use Illuminate\Http\Request;

final class AdminUserFilters
{
    public static function apply(Request $request, $builder): void
    {
        $rules = (new UserFetch())->rules();
        $rules['filter'] = 'nullable|array|max:20';
        $rules['filter.*.value'] = ['required', function ($attribute, $value, $fail) {
            if (!is_scalar($value) || strlen((string)$value) > 500) $fail('筛选值格式无效。');
        }];
        $request->validate($rules);
        foreach ($request->input('filter', []) ?: [] as $filter) {
            $condition = $filter['condition'];
            $value = $filter['value'];
            if ($condition === '模糊') { $condition = 'like'; $value = "%{$value}%"; }
            if (in_array($filter['key'], ['d', 'transfer_enable'], true)) {
                abort_unless(is_numeric($value) && (float)$value >= 0 && (float)$value <= PHP_INT_MAX / 1073741824, 422, '流量筛选值无效。');
                $value *= 1073741824;
            }
            if ($filter['key'] === 'invite_by_email') {
                $builder->whereIn('invite_user_id', User::where('email', $condition, $value)->select('id'));
            } elseif ($filter['key'] === 'plan_id' && $value === 'null') {
                $builder->whereNull('plan_id');
            } else {
                $builder->where($filter['key'], $condition, $value);
            }
        }
    }
}
