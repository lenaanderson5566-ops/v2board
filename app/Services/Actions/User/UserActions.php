<?php

namespace App\Services\Actions\User;


use App\Http\Requests\User\UserChangePassword;
use App\Http\Requests\User\UserRedeemGiftCard;
use App\Http\Requests\User\UserTransfer;
use App\Http\Requests\User\UserUpdate;
use App\Models\Giftcard;
use App\Models\Order;
use App\Models\Plan;
use App\Models\Ticket;
use App\Models\User;
use App\Services\AuthService;
use App\Services\OrderService;
use App\Services\UserService;
use App\Utils\CacheKey;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UserActions
{
    public function logout(Request $request)
    {
        $user = User::findOrFail($request->user['id']);
        return response(['data' => (new AuthService($user))->removeCurrentSession(
            $request->header('authorization') ?? ($request->isJson()
                ? $request->json('auth_data') : ($request->request->all()['auth_data'] ?? null))
        )]);
    }

    public function logoutAll(Request $request)
    {
        $user = User::findOrFail($request->user['id']);
        (new AuthService($user))->removeAllSession();
        return response(['data' => true]);
    }

    public function getActiveSession(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        $authService = new AuthService($user);
        $current = AuthService::sessionReference($request->header('Authorization') ?? '');
        $sessions = $authService->getSessions();
        $geo = new \App\Services\GeoIpService();
        $countries = [];
        foreach ($sessions as $id => &$session) {
            $ip = is_string($session['ip'] ?? null) ? $session['ip'] : null;
            $session['country_code'] = $ip ? ($countries[$ip] ??= $geo->sessionCountry($ip)) : null;
            $session['ip'] = \App\Services\GeoIpService::maskSessionIp($ip);
            unset($session['auth_data']);
            $session['current'] = $id === ($current['sessionId'] ?? null);
            $session['client_kind'] = $session['client_kind'] ?? 'unknown';
        }
        unset($session);
        return response(['data' => $sessions]);
    }

    public function removeActiveSession(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        $authService = new AuthService($user);
        return response([
            'data' => $authService->removeSession($request->input('session_id'))
        ]);
    }

    public function checkLogin(Request $request)
    {
        $data = [
            'is_login' => $request->user['id'] ? true : false
        ];
        if ($request->user['is_admin']) {
            $data['is_admin'] = true;
        }
        return response([
            'data' => $data
        ]);
    }

    public function changePassword(UserChangePassword $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        if (!Helper::multiPasswordVerify(
            $user->password_algo,
            $user->password_salt,
            $request->input('old_password'),
            $user->password
        )) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The old password is wrong'));
        }
        $reference = AuthService::sessionReference((string)($request->bearerToken() ?: $request->header('Authorization', '')));
        DB::transaction(function () use ($user, $request, $reference) {
            $current = User::whereKey($user->id)->lockForUpdate()->first();
            abort_unless($current && !$current->banned && !$current->account_deleted_at
                && hash_equals($user->password, $current->password)
                && $user->password_algo === $current->password_algo
                && $user->password_salt === $current->password_salt
                && hash_equals($user->email, $current->email),
                $request->is('api/v10/*') ? 409 : 500, __('Security settings changed. Please start again.'));
            abort_unless($reference && (int)$reference['userId'] === (int)$current->id && AuthService::sessionUser($reference),
                $request->is('api/v10/*') ? 401 : 403, __('Unauthenticated.'));
            $current->password = password_hash($request->input('new_password'), PASSWORD_DEFAULT);
            $current->password_algo = null;
            $current->password_salt = null;
            if (!$current->save()) {
                abort($request->is('api/v10/*') ? 409 : 500, __('Save failed'));
            }
            (new AuthService($current))->removeAllSession();
        }, 3);
        return response([
            'data' => true
        ]);
    }

    public function redeemgiftcard(UserRedeemGiftCard $request)
    {
        DB::beginTransaction();

        try {
            // Read the candidate first so plan deletion and redemption can lock the plan before any user or card.
            $giftcardInput = $request->giftcard;
            $candidate = Giftcard::where('code', $giftcardInput)->first(['id', 'type', 'plan_id']);
            $plan = (int) $candidate?->type === 5
                ? Plan::whereKey($candidate->plan_id)->sharedLock()->first()
                : null;

            $user = User::where('id', $request->user['id'])->lockForUpdate()->first();
            if (!$user) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
            }
            $giftcard = $candidate
                ? Giftcard::whereKey($candidate->id)->where('code', $giftcardInput)->lockForUpdate()->first()
                : null;

            if (!$giftcard) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The gift card does not exist'));
            }

            $currentTime = time();
            if ($giftcard->started_at && $currentTime < $giftcard->started_at) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The gift card is not yet valid'));
            }

            if ($giftcard->ended_at && $currentTime > $giftcard->ended_at) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The gift card has expired'));
            }

            if ($giftcard->limit_use !== null) {
                if (!is_numeric($giftcard->limit_use) || $giftcard->limit_use <= 0) {
                    abort(request()->is('api/v10/*') ? 409 : 500, __('The gift card usage limit has been reached'));
                }
            }

            $usedUserIds = $giftcard->used_user_ids ?: [];
            // Older rows may contain a JSON string inside the JSON column.
            if (is_string($usedUserIds)) $usedUserIds = json_decode($usedUserIds, true);
            if (!is_array($usedUserIds)) {
                $usedUserIds = [];
            }

            if (in_array($user->id, $usedUserIds)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The gift card has already been used by this user'));
            }

            abort_if((int) $giftcard->value < 0 && in_array((int) $giftcard->type, [1, 2, 3, 5], true),
                request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
            $usedUserIds[] = $user->id;
            $giftcard->used_user_ids = $usedUserIds;

            switch ($giftcard->type) {
                case 1:
                    abort_unless(($user->currency ?? 'CNY') === 'CNY', 422, __('This gift card is only valid for CNY accounts.'));
                    abort_if($user->balance > 2147483647 - $giftcard->value,
                        request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                    $user->balance += $giftcard->value;
                    break;
                case 2:
                    if ($user->expired_at !== null) {
                        $expiry = max($user->expired_at, $currentTime);
                        $duration = $giftcard->value * 86400;
                        abort_if($expiry > PHP_INT_MAX - $duration,
                            request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                        $user->expired_at = $expiry + $duration;
                    } else {
                        abort(request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                    }
                    break;
                case 3:
                    $bytes = $giftcard->value * 1073741824;
                    abort_if($user->transfer_enable > PHP_INT_MAX - $bytes,
                        request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                    $user->transfer_enable += $bytes;
                    break;
                case 4:
                    $user->u = 0;
                    $user->d = 0;
                    break;
                case 5:
                    if ($user->plan_id == null || ($user->expired_at !== null && $user->expired_at < $currentTime)) {
                        if (!$plan || (int) $plan->id !== (int) $giftcard->plan_id) {
                            abort(request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                        }
                        $user->plan_id = $plan->id;
                        $user->group_id = $plan->group_id;
                        $user->transfer_enable = $plan->transfer_enable * 1073741824;
                        $user->device_limit = $plan->device_limit;
                        $user->speed_limit = $plan->speed_limit;
                        $user->u = 0;
                        $user->d = 0;
                        if($giftcard->value == 0) {
                            $user->expired_at = null;
                        } else {
                            $user->expired_at = $currentTime + $giftcard->value * 86400;
                        }
                    } else {
                        abort(request()->is('api/v10/*') ? 409 : 500, __('Not suitable gift card type'));
                    }
                    break;
                default:
                    abort(request()->is('api/v10/*') ? 409 : 500, __('Unknown gift card type'));
            }

            if ($giftcard->limit_use !== null) {
                $giftcard->limit_use -= 1;
            }

            if (!$user->save() || !$giftcard->save()) {
                throw new \Exception(__('Save failed'));
            }

            if ($user->plan_id && in_array((int)$giftcard->type, [2, 5], true)) {
                \App\Services\ServiceNotification::schedule($user, (int)$giftcard->type === 2);
            }
            DB::commit();

            return response([
                'data' => true,
                'type' => $giftcard->type,
                'value' => $giftcard->value
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            if ($request->is('api/v10/*') && $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) throw $e;
            abort(500, $e->getMessage());
        }
    }

    public function info(Request $request)
    {
        $user = User::where('id', $request->user['id'])
            ->select([
                'id',
                'email',
                'language',
                'display_timezone',
                'transfer_enable',
                'credit_balance',
                'device_limit',
                'last_login_at',
                'u',
                'd',
                'created_at',
                'banned',
                'auto_renewal',
                'remind_expire',
                'remind_traffic',
                'announcement_email', 'remind_service',
                'expired_at',
                'currency',
                'balance',
                'commission_balance',
                'plan_id',
                'discount',
                'commission_rate',
                'telegram_id',
                'uuid'
            ])
            ->first();
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        $user['system_timezone'] = \App\Services\TimeZones::system();
        $user['expires_at_display'] = \App\Services\TimeZones::format($user->expired_at,$user);
        $user['ticket_creation'] = \App\Services\TicketPolicy::creation((int)$user->id);
        $user['account_status'] = (new \App\Services\AccountStatusService())->forUser($user);
        return response([
            'data' => $user
        ]);
    }

    public function getStat(Request $request)
    {
        $stat = [
            Order::where('status', 0)
                ->where('user_id', $request->user['id'])
                ->count(),
            Ticket::where('status', 0)
                ->where('user_id', $request->user['id'])
                ->count(),
            User::where('invite_user_id', $request->user['id'])
                ->count()
        ];
        return response([
            'data' => $stat
        ]);
    }

    public function getSubscribe(Request $request)
    {
        $user = User::where('id', $request->user['id'])
            ->select([
                'id',
                'plan_id',
                'token',
                'expired_at',
                'traffic_reset_anchor_at',
                'u',
                'd',
                'transfer_enable',
                'credit_balance',
                'device_limit',
                'email',
                'uuid'
            ])
            ->first();
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        if ($user->plan_id) {
            $user['plan'] = Plan::find($user->plan_id);
            if (!$user['plan']) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Subscription plan does not exist'));
            }
        }

        //统计在线设备
        $user['alive_ip'] = \App\Services\OnlineDeviceService::forUser((int) $request->user['id'])['count'];

        $user['subscribe_url'] = Helper::getSubscribeUrl($user['token']);

        $userService = new UserService();
        $reset = $userService->getResetInfo($user);
        $user['reset_at'] = $reset['at'];
        $user['reset_state'] = $reset['state'];
        $user['reset_timezone'] = $reset['timezone'];
        $displayUser=User::find($request->user['id']);
        $user['expires_at_display'] = \App\Services\TimeZones::format($user['expired_at']??null,$displayUser);
        $user['display_timezone'] = $displayUser->display_timezone;
        $user['reset_at_display'] = \App\Services\TimeZones::format($user['reset_at']??null,$displayUser);
        $user['has_subscription'] = \App\Services\TrafficCreditService::hasPeriod($user);
        $user['reset_day'] = $userService->getResetDay($user, $reset);
        $user['allow_new_period'] = false;
        return response([
            'data' => $user
        ]);
    }

    public function unbindTelegram(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        app(\App\Services\TelegramCommunityService::class)->unbind($user);
        return response([
            'data' => true
        ]);
    }

    public function resetSecurity(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        $user->uuid = Helper::guid(true);
        $user->token = Helper::guid();
        if (!$user->save()) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Reset failed'));
        }
        return response([
            'data' => Helper::getSubscribeUrl($user['token'])
        ]);
    }

    public function update(UserUpdate $request)
    {
        $updateData = $request->only([
            'language',
                'display_timezone',
            'auto_renewal',
            'remind_expire',
            'remind_traffic',
            'announcement_email', 'remind_service'
        ]);

        $user = User::find($request->user['id']);
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
        }
        try {
            $user->update($updateData);
        } catch (\Exception $e) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Save failed'));
        }

        return response([
            'data' => true
        ]);
    }

    public function transfer(UserTransfer $request)
    {
        DB::transaction(function () use ($request) {
            $user = User::whereKey($request->user['id'])->lockForUpdate()->first();
            if (!$user) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('The user does not exist'));
            }
            if ($request->input('transfer_amount') > $user->commission_balance) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Insufficient commission balance'));
            }
            $order = new Order();
            $order->currency = $user->currency ?: 'CNY';
            $orderService = new OrderService($order);
            $order->user_id = $request->user['id'];
            $order->plan_id = 0;
            $order->period = 'deposit';
            $order->trade_no = Helper::generateOrderNo();
            $order->total_amount = $request->input('transfer_amount');

            $orderService->setOrderType($user);
            // Moving existing commission into a wallet is not a new referral sale.
            $order->invite_user_id = null;
            $order->commission_balance = 0;
            $user->commission_balance = $user->commission_balance - $request->input('transfer_amount');
            $user->balance = $user->balance + $request->input('transfer_amount');
            $order->status = 3;
            $order->total_amount = 0;
            $order->surplus_amount = $request->input('transfer_amount');
            $order->callback_no = '佣金划转 Commission transfer';
            if (!$order->save()||!$user->save()) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Transfer failed'));
            }
        }, 3);

        return response([
            'data' => true
        ]);
    }

    public function getQuickLoginUrl(Request $request)
    {
        return response(['data'=>app(\App\Services\BrowserLoginLink::class)->create($request, (string)$request->header('Authorization'))]);
    }
}
