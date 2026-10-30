<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UserFetch;
use App\Http\Requests\Admin\UserSendMail;
use App\Http\Requests\Admin\UserUpdate;
use App\Models\Order;
use App\Models\Plan;
use App\Models\User;
use App\Services\AuthService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserController extends Controller
{
    private const USER_FIELDS = [
        'id', 'invite_user_id', 'telegram_id', 'email', 'language', 'display_timezone',
        'currency', 'balance', 'discount', 'commission_type', 'commission_rate',
        'commission_balance', 't', 'u', 'd', 'transfer_enable', 'credit_balance',
        'device_limit', 'banned', 'is_admin', 'last_login_at', 'last_login_ip',
        'group_id', 'plan_id', 'speed_limit', 'auto_renewal', 'remind_expire',
        'remind_traffic', 'announcement_email', 'remind_service', 'expired_at',
        'remarks', 'created_at', 'updated_at',
    ];

    public function usageResetPreview(Request $request)
    {
        return response(['data' => ['count' => User::count()]]);
    }

    public function usageReset(Request $request, \App\Services\UsageResetService $service)
    {
        $data = $request->validate([
            'kind' => 'required|in:global,grant', 'request_key' => 'required|uuid',
            'expected_count' => 'required|integer|min:1', 'quantity' => 'required_if:kind,grant|integer|min:1|max:100',
            'expires_at' => 'nullable|integer|min:'.(time() + 60),
            'confirmation' => 'required_if:kind,global|in:RESET ALL USAGE',
        ]);
        $users = User::query();
        if ($data['kind'] === 'grant') {
            $this->filter($request, $users);
            $data['filter'] = $request->input('filter', []);
        }
        return response(['data' => $service->batch($users, (int)$request->user['id'], $data)]);
    }

    public function resetSecret(Request $request)
    {
        $request->validate(['id'=>'required|integer|min:1']);
        $user = User::findOrFail($request->input('id'));
        $user->token = Helper::guid();
        $user->uuid = Helper::guid(true);
        return response([
            'data' => $user->save()
        ]);
    }

    private function filter(Request $request, $builder)
    {
        \App\Services\AdminUserFilters::apply($request, $builder);
    }

    public function fetch(UserFetch $request)
    {
        $current = max(1, (int) $request->input('current', 1));
        $pageSize = min(100, max(10, (int) $request->input('pageSize', 10)));
        $sortType = in_array($request->input('sort_type'), ['ASC', 'DESC']) ? $request->input('sort_type') : 'DESC';
        $sort = $request->input('sort') ? $request->input('sort') : 'created_at';
        // Token is needed only to build the administrator's subscription link.
        $userModel = User::select(array_merge(self::USER_FIELDS, ['token', DB::raw('(u+d) as total_used')]))
            ->orderBy($sort, $sortType);
        $this->filter($request, $userModel);
        $total = $userModel->count();
        $res = $userModel->forPage($current, $pageSize)
            ->get();
        \App\Services\AdminUserIdentity::append($res);
        $lastConnections = \App\Models\UserOnlineSnapshot::query()
            ->whereIn('user_id', $res->pluck('id'))->where('source', 'alive')
            ->select('user_id')->selectRaw('MAX(online_at) AS last_connected_at')
            ->groupBy('user_id')->pluck('last_connected_at', 'user_id');
        $lastSubscriptions = \App\Models\SubscribeLog::query()
            ->whereIn('user_id', $res->pluck('id'))
            ->select('user_id')->selectRaw('MAX(created_at) AS last_subscribe_at')
            ->groupBy('user_id')->pluck('last_subscribe_at', 'user_id');
        foreach ($res as $row) {
            $row['last_subscribe_at'] = (int) $lastSubscriptions->get($row->id) ?: null;
            $row['last_connected_at'] = max((int) $row->t, (int) $lastConnections->get($row->id)) ?: null;
        }
        $plans = Plan::whereIn('id', $res->pluck('plan_id')->filter())->pluck('name', 'id');
        $alive = \App\Services\OnlineDeviceService::forUsers($res->pluck('id')->all());
        for ($i = 0; $i < count($res); $i++) {
            if ($plans->has($res[$i]['plan_id'])) $res[$i]['plan_name'] = $plans->get($res[$i]['plan_id']);
            //统计在线设备
            $state = $alive[$res[$i]['id']];
            $ips = array_map(fn($item) => $item['ip'].'_'.$item['node'], $state['connections']);
            $res[$i]['alive_ip'] = $state['count'];
            $res[$i]['ips'] = implode(', ', $ips);
            $res[$i]['subscribe_url'] = Helper::getSubscribeUrl($res[$i]['token']);
            $res[$i]->makeHidden('token');
        }
        return response([
            'data' => $res,
            'total' => $total
        ]);
    }

    public function getUserInfoById(Request $request)
    {
        if (empty($request->input('id'))) {
            abort(500, '参数错误');
        }
        $user = User::select(self::USER_FIELDS)->find($request->input('id'));
        if (!$user) abort(404, '用户不存在');
        if ($user->invite_user_id) {
            $user['invite_user'] = User::select(['id', 'email'])->find($user->invite_user_id);
        }
        return response([
            'data' => $user
        ]);
    }

    public function update(UserUpdate $request)
    {
        $params = $request->validated();
        $user = User::find($request->input('id'));
        if (!$user) {
            abort(500, '用户不存在');
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
        if (array_key_exists('plan_id', $params) && $params['plan_id'] !== null) {
            $plan = Plan::find($params['plan_id']);
            if (!$plan) {
                abort(500, '订阅计划不存在');
            }
            $params['group_id'] = $plan->group_id;
        } elseif (array_key_exists('plan_id', $params)) {
            $params['group_id'] = null;
        }
        if ($request->has('invite_user_email') && $request->input('invite_user_email')) {
            $inviteUser = User::where('email', $request->input('invite_user_email'))->first();
            abort_unless($inviteUser && (int)$inviteUser->id !== (int)$user->id, 422, '请选择有效的其他用户作为邀请人');
            $params['invite_user_id'] = $inviteUser->id;
        } elseif ($request->has('invite_user_email')) {
            $params['invite_user_id'] = null;
        }

        unset($params['id'], $params['invite_user_email']);
        $revoke = isset($params['password']) || $user->email !== $params['email']
            || (int)($params['banned'] ?? 0) === 1;

        try {
            $user->update($params);
            if ($revoke) (new AuthService($user))->removeAllSession();
        } catch (\Exception $e) {
            abort(500, '保存失败');
        }
        return response([
            'data' => true
        ]);
    }

    private function checkScope(Request $request, $builder)
    {
        $request->validate(['expected_count' => 'nullable|integer|min:1']);
        if ($request->has('expected_count') && $builder->count() != $request->input('expected_count')) {
            abort(409, '匹配人数已变化，请刷新列表后重新确认');
        }
    }

    public function sendMail(UserSendMail $request)
    {
        $purpose=$request->input('purpose');
        if($purpose==='marketing') {
            abort_unless(config('v2board.email_announcements_enabled',1),422,'推广邮件已暂停。');
            try { \App\Services\Mail\MailAudience::origin(); } catch (\Throwable $e) { abort(422,'请先配置 HTTPS 邮件回调与退订 API 地址。'); }
        }
        $builder=User::orderBy('id');
        $this->filter($request,$builder); $this->checkScope($request,$builder);
        $id=\App\Services\Mail\MailCampaign::create($builder,$request->validated(),(int)$request->user['id']);
        return response(['data'=>['campaign_id'=>$id]],202);
    }

    public function previewMailAudience(Request $request)
    {
        $request->validate(['purpose'=>'required|in:service,marketing']);
        $builder=User::orderBy('id'); $this->filter($request,$builder); $this->checkScope($request,$builder);
        return response(['data'=>\App\Services\Mail\MailCampaign::preview($builder,$request->input('purpose'))]);
    }

    public function ban(Request $request)
    {
        $request->validate(['filter' => 'required|array|min:1']);
        $sortType = in_array($request->input('sort_type'), ['ASC', 'DESC']) ? $request->input('sort_type') : 'DESC';
        $sort = $request->input('sort') ? $request->input('sort') : 'created_at';
        $builder = User::orderBy($sort, $sortType);
        $this->filter($request, $builder);
        $this->checkScope($request, $builder);
        try {
            $builder->each(function ($user){
                $authService = new AuthService($user);
                $authService->removeAllSession();
            });
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

    public function allDel(Request $request)
    {
        $request->validate(['filter'=>'required|array|min:1','expected_count'=>'nullable|integer|min:1']);
        DB::transaction(function () use ($request) {
            $builder = User::orderBy('id');
            $this->filter($request, $builder);
            // Freeze the confirmed set: cleanup can change fields used by the filter.
            $users = $builder->lockForUpdate()->get(['id']);
            if ($request->has('expected_count') && $users->count() !== (int)$request->input('expected_count')) {
                abort(409, '匹配人数已变化，请刷新列表后重新确认');
            }
            foreach ($users as $user) $this->deleteUser($user);
        }, 3);
        return response(['data'=>true]);
    }

    public function delUser(Request $request)
    {
        $request->validate(['id'=>'required|integer|min:1']);
        DB::transaction(function () use ($request) {
            $user = User::whereKey($request->input('id'))->lockForUpdate()->first();
            if (!$user) abort(500, '用户不存在');
            $this->deleteUser($user);
        }, 3);
        return response(['data'=>true]);
    }

    private function deleteUser(User $user): void
    {
        app(\App\Services\Actions\User\EraseAccountData::class)->erase($user, true);
        Order::where('user_id', $user->id)->delete();
        $user->delete();
        (new AuthService($user))->removeAllSession();
    }
}
