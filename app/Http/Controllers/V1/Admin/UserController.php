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
    private const EDIT_FIELDS = [
        'email', 'password', 'plan_id', 'transfer_enable', 'u', 'd', 'balance', 'expired_at',
        'device_limit', 'speed_limit', 'banned', 'is_admin', 'discount', 'commission_rate',
        'commission_type', 'commission_balance', 'invite_user_email', 'remarks',
    ];

    public function usageResetPreview(Request $request)
    {
        return response(['data' => ['count' => User::count()]]);
    }

    public function usageResetGrantPreview(Request $request, \App\Services\UsageResetService $service)
    {
        $input = $request->validate(['expected_count'=>'required|integer|min:1']);
        $users = User::query();
        $this->filter($request, $users);
        return response(['data' => $service->previewGrant($users, (int)$request->user['id'], (int)$input['expected_count'])]);
    }

    public function usageReset(Request $request, \App\Services\UsageResetService $service)
    {
        $data = $request->validate([
            'kind' => 'required|in:global,grant', 'request_key' => 'required|uuid',
            'expected_count' => 'required|integer|min:1', 'quantity' => 'required_if:kind,grant|integer|min:1|max:100',
            'expires_at' => 'nullable|integer|min:'.(time() + 60),
            'confirmation' => 'required_if:kind,global|in:RESET ALL USAGE',
            'scope_token' => 'required_if:kind,grant|string|regex:/\A[a-f0-9]{64}\z/',
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
        $userIds = $res->pluck('id');
        $lastConnections = \App\Models\UserOnlineSnapshot::query()
            ->whereIn('user_id', $userIds)->where('source', 'alive')
            ->select('user_id')->selectRaw('MAX(online_at) AS last_connected_at')
            ->groupBy('user_id')->pluck('last_connected_at', 'user_id');
        $lastSubscriptions = \App\Models\SubscribeLog::query()
            ->whereIn('user_id', $userIds)
            ->select('user_id')->selectRaw('MAX(created_at) AS last_subscribe_at')
            ->groupBy('user_id')->pluck('last_subscribe_at', 'user_id');
        // A verified external payment contributes its principal in the order currency.
        $recharges = Order::query()
            ->join('v2_user', 'v2_order.user_id', '=', 'v2_user.id')
            ->whereIn('v2_order.user_id', $userIds)
            ->whereColumn('v2_order.currency', 'v2_user.currency')
            ->where('period', 'deposit')->where('v2_order.plan_id', 0)->where('status', 3)
            ->where('total_amount', '>', 0)->where('paid_at', '>', 0)
            ->where('payment_id', '>', 0)->whereRaw("COALESCE(TRIM(callback_no), '') <> ''")
            ->whereNotIn(DB::raw('TRIM(callback_no)'), ['manual_operation', '佣金划转 Commission transfer'])
            ->select('v2_order.user_id')->selectRaw('SUM(total_amount) AS amount')
            ->groupBy('v2_order.user_id')->pluck('amount', 'user_id');
        foreach ($res as $row) {
            $row['last_subscribe_at'] = (int) $lastSubscriptions->get($row->id) ?: null;
            $row['last_connected_at'] = max((int) $row->t, (int) $lastConnections->get($row->id)) ?: null;
            $row['total_recharge_amount'] = (int) $recharges->get($row->id, 0);
        }
        $plans = Plan::whereIn('id', $res->pluck('plan_id')->filter())->pluck('name', 'id');
        $alive = \App\Services\OnlineDeviceService::forUsers($userIds->all());
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
        $input = $request->validate(['id'=>'required|integer|min:1']);
        $user = User::select([...self::USER_FIELDS, 'password', 'password_algo', 'password_salt'])->findOrFail($input['id']);
        if ($user->invite_user_id) {
            $user['invite_user'] = User::select(['id', 'email'])->find($user->invite_user_id);
        }
        $user['edit_versions'] = collect(self::EDIT_FIELDS)->mapWithKeys(
            fn (string $field) => [$field => $this->editVersion($user, $field)]
        )->all();
        return response([
            'data' => $user
        ]);
    }

    public function update(UserUpdate $request)
    {
        $params = $request->validated();
        $userId = $params['id'];
        $versions = $params['edit_versions'];
        unset($params['id'], $params['edit_versions']);
        if (!isset($params['password'])) unset($params['password']);
        $user = DB::transaction(function () use ($params, $userId, $versions) {
            $plan = isset($params['plan_id']) ? Plan::whereKey($params['plan_id'])->sharedLock()->first() : null;
            $restrictsAccess = (isset($params['banned']) && (int)$params['banned'] === 1)
                || (isset($params['is_admin']) && (int)$params['is_admin'] === 0);
            if ($restrictsAccess) {
                $this->assertAdministratorRemains($this->lockActiveAdministrators(), [$userId]);
            }
            $user = User::whereKey($userId)->lockForUpdate()->firstOrFail();
            foreach (array_keys($params) as $field) {
                abort_unless(isset($versions[$field]) && hash_equals($this->editVersion($user, $field), $versions[$field]),
                    409, '待修改的字段已变化，请重新打开编辑窗口并核对最新值。');
            }
            if (array_key_exists('plan_id', $params)) {
                abort_if(isset($params['plan_id']) && !$plan, 422, '订阅计划不存在');
                $params['group_id'] = $plan?->group_id;
            }
            $emailChanged = isset($params['email']) && $user->email !== $params['email'];
            if ($emailChanged) {
                abort_if(User::where('email', $params['email'])->where('id', '<>', $user->id)->exists(), 422, '邮箱已被使用');
            }
            if (isset($params['password'])) {
                $params['password'] = password_hash($params['password'], PASSWORD_DEFAULT);
                $params['password_algo'] = null;
            }
            if (array_key_exists('invite_user_email', $params)) {
                $inviterEmail = $params['invite_user_email'];
                $inviter = $inviterEmail ? User::where('email', $inviterEmail)->first() : null;
                abort_if($inviterEmail && (!$inviter || (int)$inviter->id === (int)$user->id), 422, '请选择有效的其他用户作为邀请人');
                $params['invite_user_id'] = $inviter?->id;
                unset($params['invite_user_email']);
            }
            $revoke = isset($params['password']) || $emailChanged
                || (isset($params['banned']) && (int)$params['banned'] === 1);
            $user->update($params);
            return $revoke ? $user : null;
        }, 3);
        if ($user) (new AuthService($user))->removeAllSession();
        return response([
            'data' => true
        ]);
    }

    private function editVersion(User $user, string $field): string
    {
        $value = match ($field) {
            'invite_user_email' => $user->getRawOriginal('invite_user_id'),
            'plan_id' => [$user->getRawOriginal('plan_id'), $user->getRawOriginal('group_id')],
            'password' => [$user->getRawOriginal('password'), $user->getRawOriginal('password_algo'), $user->getRawOriginal('password_salt')],
            default => $user->getRawOriginal($field),
        };
        return hash_hmac('sha256', serialize([$user->id, $field, $value]), (string)config('app.key'));
    }

    public function sendMail(UserSendMail $request)
    {
        $purpose=$request->input('purpose');
        if($purpose==='marketing') {
            abort_unless(config('fastai.email_announcements_enabled',1),422,'推广邮件已暂停。');
            try { \App\Services\Mail\MailAudience::origin(); } catch (\Throwable $e) { abort(422,'请先配置 HTTPS 邮件回调与退订 API 地址。'); }
        }
        $builder=User::orderBy('id');
        $this->filter($request,$builder);
        $id=\App\Services\Mail\MailCampaign::create($builder,$request->validated(),(int)$request->user['id']);
        return response(['data'=>['campaign_id'=>$id]],202);
    }

    public function previewMailAudience(Request $request)
    {
        $input = $request->validate(['purpose'=>'required|in:service,marketing', 'expected_count'=>'nullable|integer|min:1']);
        $builder = User::query();
        $this->filter($request, $builder);
        $preview = \App\Services\Mail\MailCampaign::preview($builder, $input['purpose'], (int)$request->user['id']);
        abort_if(isset($input['expected_count']) && $preview['total'] !== (int)$input['expected_count'],
            409, '匹配人数已变化，请刷新列表后重新确认');
        return response(['data' => $preview]);
    }

    public function previewBulk(Request $request)
    {
        $input = $request->validate([
            'operation' => 'required|in:ban,delete',
            'filter' => 'required|array|min:1',
            'expected_count' => 'required|integer|min:1',
        ]);
        $builder = User::orderBy('id');
        $this->filter($request, $builder);
        $users = $builder->get(['id', 'email']);
        abort_unless($users->count() === (int)$input['expected_count'], 409, '匹配人数已变化，请刷新列表后重新确认');
        return response(['data' => [
            'scope_token' => $this->bulkScopeToken($request, $input['operation'], $users),
            'total' => $users->count(),
            'sample' => $users->take(10)->map(fn (User $user) => ['id' => $user->id, 'email' => $user->email])->all(),
        ]], 200, ['Cache-Control' => 'private, no-store']);
    }

    public function ban(Request $request)
    {
        $users = DB::transaction(function () use ($request) {
            $administrators = $this->lockActiveAdministrators();
            $users = $this->lockConfirmedUsers($request, 'ban');
            $this->assertAdministratorRemains($administrators, $users->modelKeys());
            User::whereKey($users->modelKeys())->update(['banned'=>1]);
            return $users;
        }, 3);
        foreach ($users as $user) (new AuthService($user))->removeAllSession();

        return response([
            'data' => true
        ]);
    }

    public function allDel(Request $request)
    {
        DB::transaction(function () use ($request) {
            $administrators = $this->lockActiveAdministrators();
            $users = $this->lockConfirmedUsers($request, 'delete');
            $this->assertAdministratorRemains($administrators, $users->modelKeys());
            foreach ($users as $user) $this->deleteUser($user);
        }, 3);
        return response(['data'=>true]);
    }

    public function delUser(Request $request)
    {
        $request->validate(['id'=>'required|integer|min:1']);
        DB::transaction(function () use ($request) {
            $administrators = $this->lockActiveAdministrators();
            $user = User::whereKey($request->input('id'))->lockForUpdate()->first();
            if (!$user) abort(500, '用户不存在');
            $this->assertAdministratorRemains($administrators, [$user->id]);
            $this->deleteUser($user);
        }, 3);
        return response(['data'=>true]);
    }

    private function lockActiveAdministrators(): \Illuminate\Support\Collection
    {
        $active = User::where('is_admin', 1)->where('banned', 0)->whereNull('account_deleted_at');
        $ids = (clone $active)->pluck('id')->all();
        // Lock by primary key, then recheck eligibility after any concurrent write.
        return $active->whereKey($ids)->orderBy('id')->lockForUpdate()->pluck('id');
    }

    private function assertAdministratorRemains(\Illuminate\Support\Collection $administrators, array $targetIds): void
    {
        abort_if($administrators->isNotEmpty() && $administrators->diff($targetIds)->isEmpty(),
            409, '操作后必须至少保留一个可登录的管理员账号。');
    }

    private function lockConfirmedUsers(Request $request, string $operation): \Illuminate\Database\Eloquent\Collection
    {
        $input = $request->validate([
            'filter' => 'required|array|min:1',
            'expected_count' => 'required|integer|min:1',
            'scope_token' => 'required|string|regex:/\A[a-f0-9]{64}\z/',
        ], ['scope_token.required' => '请先检查受影响用户']);
        $builder = User::orderBy('id');
        $this->filter($request, $builder);
        $users = $builder->lockForUpdate()->get(['id']);
        abort_unless($users->count() === (int)$input['expected_count']
            && hash_equals($this->bulkScopeToken($request, $operation, $users), $input['scope_token']),
            409, '受影响用户已变化，请重新检查后确认');
        return $users;
    }

    private function bulkScopeToken(Request $request, string $operation, iterable $users): string
    {
        $administratorId = (int)$request->user['id'];
        $hash = hash_init('sha256', HASH_HMAC, (string)config('app.key'));
        hash_update($hash, "admin-user-bulk-v1:$administratorId:$operation\n");
        foreach ($users as $user) {
            hash_update($hash, $user->id."\n");
        }
        return hash_final($hash);
    }

    private function deleteUser(User $user): void
    {
        app(\App\Services\Actions\User\EraseAccountData::class)->erase($user, true);
        Order::where('user_id', $user->id)->delete();
        $user->delete();
        (new AuthService($user))->removeAllSession();
    }
}
