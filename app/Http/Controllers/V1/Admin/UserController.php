<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UserFetch;
use App\Http\Requests\Admin\UserGenerate;
use App\Http\Requests\Admin\UserSendMail;
use App\Http\Requests\Admin\UserUpdate;
use App\Models\InviteCode;
use App\Models\EmailInvitation;
use App\Models\Ticket;
use App\Models\Order;
use App\Models\Plan;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\AuthService;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

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
        $user = User::find($request->input('id'));
        if (!$user) abort(500, '用户不存在');
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
        $plan = Plan::get();
        for ($i = 0; $i < count($res); $i++) {
            for ($k = 0; $k < count($plan); $k++) {
                if ($plan[$k]['id'] == $res[$i]['plan_id']) {
                    $res[$i]['plan_name'] = $plan[$k]['name'];
                }
            }
            //统计在线设备
            $countalive = 0;
            $ips = [];
            $ips_array = Cache::get('ALIVE_IP_USER_'. $res[$i]['id']);
            if ($ips_array) {
                $countalive = $ips_array['alive_ip'];
                foreach($ips_array as $nodetypeid => $data) {
                    if (!is_int($data) && isset($data['aliveips'])) {
                        foreach($data['aliveips'] as $ip_NodeId) {
                            $ip = explode("_", $ip_NodeId)[0];
                            $ips[] = $ip . '_' . $nodetypeid;
                        }
                    }
                }
            }
            $res[$i]['alive_ip'] = $countalive;
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
        if (isset($params['plan_id'])) {
            $plan = Plan::find($params['plan_id']);
            if (!$plan) {
                abort(500, '订阅计划不存在');
            }
            $params['group_id'] = $plan->group_id;
        } else {
            $params['group_id'] = null;
        }
        if ($request->has('invite_user_email') && $request->input('invite_user_email')) {
            $inviteUser = User::where('email', $request->input('invite_user_email'))->first();
            if ($inviteUser) {
                $params['invite_user_id'] = $inviteUser->id;
            }
        } elseif ($request->has('invite_user_email')) {
            $params['invite_user_id'] = null;
        }

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

    public function dumpCSV(Request $request)
    {
        $userModel = User::orderBy('id', 'asc');
        $this->filter($request, $userModel);
        $res = $userModel->get();
        $plan = Plan::get();
        for ($i = 0; $i < count($res); $i++) {
            for ($k = 0; $k < count($plan); $k++) {
                if ($plan[$k]['id'] == $res[$i]['plan_id']) {
                    $res[$i]['plan_name'] = $plan[$k]['name'];
                }
            }
        }

        $rows = [];
        foreach($res as $user) {
            $expireDate = $user['expired_at'] === NULL ? '长期有效' : date('Y-m-d H:i:s', $user['expired_at']);
            $balance = $user['balance'] / 100;
            $commissionBalance = $user['commission_balance'] / 100;
            $transferEnable = $user['transfer_enable'] ? $user['transfer_enable'] / 1073741824 : 0;
            $deviceLimit = $user['device_limit'] ? $user['device_limit'] : NULL;
            $notUseFlow = (($user['transfer_enable'] - ($user['u'] + $user['d'])) / 1073741824) ?? 0;
            $planName = $user['plan_name'] ?? '无订阅';
            $subscribeUrl =  Helper::getSubscribeUrl($user['token']);
            $rows[] = [$user['email'], $user['currency'] ?? 'CNY', $balance, $commissionBalance, $transferEnable, $deviceLimit, $notUseFlow, $expireDate, $planName, $subscribeUrl];

        }
        return $this->csvResponse(['邮箱', '币种', '余额', '推广佣金', '总流量', '设备数限制', '剩余流量', '套餐到期时间', '订阅计划', '订阅地址'], $rows, 'users.csv');
    }

    private function checkScope(Request $request, $builder)
    {
        $request->validate(['expected_count' => 'nullable|integer|min:1']);
        if ($request->has('expected_count') && $builder->count() != $request->input('expected_count')) {
            abort(409, '匹配人数已变化，请刷新列表后重新确认');
        }
    }

    private function csvResponse(array $headers, array $rows, string $filename)
    {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, "\xEF\xBB\xBF");
        foreach (array_merge([$headers], $rows) as $row) {
            $row = array_map(function ($value) {
                $value = (string) $value;
                return preg_match('/^[=+@\-\t\r]/', $value) ? "'" . $value : $value;
            }, $row);
            fputcsv($stream, $row, ',', '"', '');
        }
        rewind($stream);
        $content = stream_get_contents($stream);
        fclose($stream);
        return response($content, 200, ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="' . $filename . '"']);
    }

    public function generate(UserGenerate $request)
    {
        if ($request->input('email_prefix')) {
            if ($request->input('plan_id')) {
                $plan = Plan::find($request->input('plan_id'));
                if (!$plan) {
                    abort(500, '订阅计划不存在');
                }
            }
            $user = [
                'email' => $request->input('email_prefix') . '@' . $request->input('email_suffix'),
                'plan_id' => isset($plan->id) ? $plan->id : NULL,
                'group_id' => isset($plan->group_id) ? $plan->group_id : NULL,
                'transfer_enable' => isset($plan->transfer_enable) ? $plan->transfer_enable * 1073741824 : 0,
                'device_limit' => isset($plan->device_limit) ? $plan->device_limit : NULL,
                'expired_at' => $request->input('expired_at') ?? NULL,
                'uuid' => Helper::guid(true),
                'token' => Helper::guid()
            ];
            if (User::where('email', $user['email'])->first()) {
                abort(500, '邮箱已存在于系统中');
            }
            $user['password'] = password_hash($request->input('password') ?? $user['email'], PASSWORD_DEFAULT);
            if (!User::create($user)) {
                abort(500, '生成失败');
            }
            return response([
                'data' => true
            ]);
        }
        if ($request->input('generate_count')) {
            return $this->multiGenerate($request);
        }
    }

    private function multiGenerate(Request $request)
    {
        if ($request->input('plan_id')) {
            $plan = Plan::find($request->input('plan_id'));
            if (!$plan) {
                abort(500, '订阅计划不存在');
            }
        }
        $users = [];
        for ($i = 0;$i < $request->input('generate_count');$i++) {
            $user = [
                'currency' => config('v2board.new_user_currency','CNY'),
                'email' => Helper::randomChar(6) . '@' . $request->input('email_suffix'),
                'plan_id' => isset($plan->id) ? $plan->id : NULL,
                'group_id' => isset($plan->group_id) ? $plan->group_id : NULL,
                'transfer_enable' => isset($plan->transfer_enable) ? $plan->transfer_enable * 1073741824 : 0,
                'device_limit' => isset($plan->device_limit) ? $plan->device_limit : NULL,
                'expired_at' => $request->input('expired_at') ?? NULL,
                'uuid' => Helper::guid(true),
                'token' => Helper::guid(),
                'created_at' => time(),
                'updated_at' => time()
            ];
            $user['password'] = password_hash($request->input('password') ?? $user['email'], PASSWORD_DEFAULT);
            array_push($users, $user);
        }
        DB::beginTransaction();
        if (!User::insert($users)) {
            DB::rollBack();
            abort(500, '生成失败');
        }
        DB::commit();
        $rows = [];
        foreach($users as $user) {
            $expireDate = $user['expired_at'] === NULL ? '长期有效' : date('Y-m-d H:i:s', $user['expired_at']);
            $createDate = date('Y-m-d H:i:s', $user['created_at']);
            $password = $request->input('password') ?? $user['email'];
            $subscribeUrl = Helper::getSubscribeUrl($user['token']);
            $rows[] = [$user['email'], $password, $expireDate, $user['uuid'], $createDate, $subscribeUrl];
        }
        return $this->csvResponse(['账号', '密码', '过期时间', 'UUID', '创建时间', '订阅地址'], $rows, 'generated-users.csv');
    }

    public function sendMail(UserSendMail $request)
    {
        $purpose=$request->input('purpose');
        if($purpose==='marketing') {
            abort_unless(config('v2board.email_announcements_enabled',1),422,'推广邮件已暂停。');
            try { \App\Services\MailAudience::origin(); } catch (\Throwable $e) { abort(422,'请先配置 HTTPS 邮件回调与退订 API 地址。'); }
        }
        $builder=User::orderBy('id');
        $this->filter($request,$builder); $this->checkScope($request,$builder);
        $id=\App\Services\MailCampaign::create($builder,$request->validated(),(int)$request->user['id']);
        return response(['data'=>['campaign_id'=>$id]],202);
    }

    public function previewMailAudience(Request $request)
    {
        $request->validate(['purpose'=>'required|in:service,marketing']);
        $builder=User::orderBy('id'); $this->filter($request,$builder); $this->checkScope($request,$builder);
        return response(['data'=>\App\Services\MailCampaign::preview($builder,$request->input('purpose'))]);
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
        $request->validate(['filter' => 'required|array|min:1']);
        $sortType = in_array($request->input('sort_type'), ['ASC', 'DESC']) ? $request->input('sort_type') : 'DESC';
        $sort = $request->input('sort') ? $request->input('sort') : 'created_at';
        $builder = User::orderBy($sort, $sortType);
        $this->filter($request, $builder);
        $this->checkScope($request, $builder);

        DB::beginTransaction();
        try {
            $builder->each(function ($user){
                $authService = new AuthService($user);
                $authService->removeAllSession();
                Order::where('user_id', $user->id)->delete();
                InviteCode::where('user_id', $user->id)->delete();
                EmailInvitation::where('user_id', $user->id)->orWhere('accepted_user_id', $user->id)->delete();
                $tickets = Ticket::where('user_id', $user->id)->get();
                foreach($tickets as $ticket) {
                    TicketMessage::where('ticket_id', $ticket->id)->delete();
                }
                Ticket::where('user_id', $user->id)->delete();
                User::where('invite_user_id', $user->id)->update(['invite_user_id' => null]);
            });
            $builder->delete();
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            abort(500, '批量删除用户信息失败');
        }  

        return response([
            'data' => true
        ]);
    }

    public function delUser(Request $request)
    {
        $user = User::find($request->input('id'));
        if (!$user) {
            abort(500, '用户不存在');
        }
        DB::beginTransaction();
        try {
            $authService = new AuthService($user);
            $authService->removeAllSession();
            Order::where('user_id', $request->input('id'))->delete();
            User::where('invite_user_id', $request->input('id'))->update(['invite_user_id' => null]);
            InviteCode::where('user_id', $request->input('id'))->delete();
            EmailInvitation::where('user_id', $user->id)->orWhere('accepted_user_id', $user->id)->delete();
            
            $tickets = Ticket::where('user_id', $request->input('id'))->get();
            foreach($tickets as $ticket) {
                TicketMessage::where('ticket_id', $ticket->id)->delete();
            }
            Ticket::where('user_id', $request->input('id'))->delete();
    
            $user->delete();
            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            abort(500, '删除用户失败');
        }

        return response([
            'data' => true
        ]);
    }
}
