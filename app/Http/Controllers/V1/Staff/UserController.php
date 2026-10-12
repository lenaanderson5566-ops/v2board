<?php

namespace App\Http\Controllers\V1\Staff;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UserSendMail;
use App\Http\Requests\Staff\UserUpdate;
use App\Jobs\SendEmailJob;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function getUserInfoById(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(500, '参数错误');
        }
        $user = User::where('is_admin', 0)
            ->where('id', $request->input('id'))
            ->where('is_staff', 0)
            ->first();
        if (!$user) abort(404, '用户不存在');
        return response([
            'data' => $user->only(['id', 'email', 'transfer_enable', 'device_limit', 'expired_at', 'banned', 'plan_id', 'group_id', 'commission_rate', 'discount', 'u', 'd', 'balance', 'commission_balance', 'created_at', 'updated_at'])
        ]);
    }

    public function update(UserUpdate $request)
    {
        $params = $request->validated();
        $user = User::where('is_admin', 0)->where('is_staff', 0)->find($request->input('id'));
        if (!$user) {
            abort(404, '用户不存在');
        }
        if (User::where('email', $params['email'])->first() && $user->email !== $params['email']) {
            abort(500, '邮箱已被使用');
        }
        if (isset($params['password'])) {
            $params['password'] = password_hash($params['password'], PASSWORD_DEFAULT);
            $params['password_algo'] = NULL;
        } else {
            unset($params['password']);
        }
        if (isset($params['plan_id'])) {
            $plan = Plan::find($params['plan_id']);
            if (!$plan) {
                abort(500, '订阅计划不存在');
            }
            $params['group_id'] = $plan->group_id;
        }

        $revoke = isset($params['password']) || $user->email !== $params['email'] || (int)$params['banned'] === 1;
        try {
            $user->update($params);
            if ($revoke) (new \App\Services\AuthService($user))->removeAllSession();
        } catch (\Exception $e) {
            abort(500, '保存失败');
        }
        return response([
            'data' => true
        ]);
    }

    public function sendMail(UserSendMail $request)
    {
        $builder = $this->filteredUsers($request);
        $users = $builder->cursor();
        foreach ($users as $user) {
            SendEmailJob::dispatch([
                'email' => $user->email,
                'subject' => $request->input('subject'),
                'translations' => $request->input('translations', []),
                'template_name' => 'notify',
                'template_value' => [
                    'name' => config('v2board.app_name', 'V2Board'),
                    'url' => config('v2board.app_url'),
                    'content' => $request->input('content')
                ]
            ], 'send_email_mass');
        }

        return response([
            'data' => true
        ]);
    }

    public function ban(Request $request)
    {
        $builder = $this->filteredUsers($request);
        try {
            $builder->update([
                'banned' => 1
            ]);
        } catch (\Exception $e) {
            abort(500, '处理失败');
        }

        return response([
            'data' => true
        ]);
    }
    private function filteredUsers(Request $request)
    {
        $rules = (new \App\Http\Requests\Admin\UserFetch())->rules();
        $rules['sort'] = 'nullable|in:id,created_at,banned,plan_id,group_id,transfer_enable,device_limit,expired_at,balance,commission_balance';
        $rules['filter.*.key'] = 'required|in:id,email,transfer_enable,device_limit,d,expired_at,invite_by_email,invite_user_id,plan_id,banned';
        $rules['filter.*.value'] = ['required', function ($attribute, $value, $fail) {
            if (!is_string($value) && !is_numeric($value)) $fail('过滤值参数有误');
        }];
        $request->validate($rules);
        $builder = User::where('is_admin', 0)->where('is_staff', 0)
            ->orderBy($request->input('sort') ?: 'created_at', $request->input('sort_type') ?: 'DESC');
        foreach ($request->input('filter') ?: [] as $filter) {
            $key = $filter['key'];
            $condition = $filter['condition'];
            $value = $filter['value'];
            if ($condition === '模糊') { $condition = 'like'; $value = "%{$value}%"; }
            if (in_array($key, ['d', 'transfer_enable'], true)) {
                abort_unless(is_numeric($value), 422, '流量过滤值必须为数字');
                $value *= 1073741824;
            }
            if ($key === 'invite_by_email') {
                $builder->whereIn('invite_user_id', User::where('email', $condition, $value)->select('id'));
            } elseif ($key === 'plan_id' && $value === 'null') {
                $builder->whereNull('plan_id');
            } else {
                $builder->where($key, $condition, $value);
            }
        }
        return $builder;
    }

}
