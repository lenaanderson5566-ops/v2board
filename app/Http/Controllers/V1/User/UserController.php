<?php

namespace App\Http\Controllers\V1\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\User\UserChangePassword;
use App\Http\Requests\User\UserRedeemGiftCard;
use App\Http\Requests\User\UserTransfer;
use App\Http\Requests\User\UserUpdate;
use App\Models\Giftcard;
use App\Models\LoginLog;
use App\Models\Order;
use App\Models\Plan;
use App\Models\Ticket;
use App\Models\User;
use App\Models\UserConnectionLog;
use App\Services\AuthService;
use App\Services\OrderService;
use App\Services\CurrencyRateService;
use App\Services\LocaleService;
use App\Services\QuotaPackageService;
use App\Services\UserService;
use App\Utils\CacheKey;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class UserController extends Controller
{
    public function getActiveSession(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $authService = new AuthService($user);
        return response([
            'data' => $authService->getSessions()
        ]);
    }

    public function removeActiveSession(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $authService = new AuthService($user);
        return response([
            'data' => $authService->removeSession($request->input('session_id'))
        ]);
    }

    public function logout(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $authorization = $request->input('auth_data') ?? $request->header('authorization');
        if (!$authorization) {
            abort(500, __('Not logged in or login expired'));
        }
        $authService = new AuthService($user);
        return response([
            'data' => $authService->removeSessionByAuthData($authorization)
        ]);
    }

    public function logoutAll(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $authService = new AuthService($user);
        return response([
            'data' => $authService->removeAllSession()
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
            abort(500, __('The user does not exist'));
        }
        if (!Helper::multiPasswordVerify(
            $user->password_algo,
            $user->password_salt,
            $request->input('old_password'),
            $user->password
        )) {
            abort(500, __('The old password is wrong'));
        }
        $user->password = password_hash($request->input('new_password'), PASSWORD_DEFAULT);
        $user->password_algo = NULL;
        $user->password_salt = NULL;
        if (!$user->save()) {
            abort(500, __('Save failed'));
        }
        $authService = new AuthService($user);
        $authService->removeAllSession();
        return response([
            'data' => true
        ]);
    }

    public function newPeriod(Request $request) 
    {
        if (!config('v2board.allow_new_period', 0)) {
            abort(500, __('Renewal is not allowed'));
        }
        DB::beginTransaction();
        try {
            $user = User::find($request->user['id']);
            if (!$user) {
                abort(500, __('The user does not exist'));
            }
            if ($user->transfer_enable > $user->u + $user->d) {
                abort(500, __('You have not used up your traffic, you cannot renew your subscription'));
            }
            $userService = new UserService();
            $reset_day = $userService->getResetDay($user);
            if ($reset_day === null) {
                abort(500, __('You do not allow to renew the subscription'));
            }
            unset($user->plan);
            $reset_period = $userService->getResetPeriod($user);
            if ($reset_period === null) {
                abort(500, __('You do not allow to renew the subscription'));
            }
            switch ($reset_period) {
                case 1:
                    $reset_day = 30;
                    $reset_period = 30;
                    break;
                case 30:
                    break;
                case 12:
                    $reset_day = 365;
                    $reset_period = 365;
                    break;
                case 365:
                    break;
                default:
                    abort(500, __('Invalid reset period'));
            }
            if ($reset_day <= 0) {
                $reset_day = $reset_period;
            }
            if ($user->expired_at !== null && ($reset_period + 1) * 86400 < $user->expired_at - time()) {
                if (!$user->update(
                    [
                        'expired_at' => $user->expired_at - $reset_day * 86400,
                        'u' => 0,
                        'd' => 0
                    ]
                )) {
                    throw new \Exception(__('Save failed'));
                }
            } else {
                abort(500, __('You do not have enough time to renew your subscription'));
            }

            DB::commit();
            return response([
                'data' => true
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            abort(500, $e->getMessage());
        }
    }

    public function redeemgiftcard(UserRedeemGiftCard $request)
    {
        DB::beginTransaction();

        try {
            $user = User::find($request->user['id']);
            if (!$user) {
                abort(500, __('The user does not exist'));
            }
            $giftcard_input = $request->giftcard;
            $giftcard = Giftcard::where('code', $giftcard_input)->first();

            if (!$giftcard) {
                abort(500, __('The gift card does not exist'));
            }

            $currentTime = time();
            if ($giftcard->started_at && $currentTime < $giftcard->started_at) {
                abort(500, __('The gift card is not yet valid'));
            }

            if ($giftcard->ended_at && $currentTime > $giftcard->ended_at) {
                abort(500, __('The gift card has expired'));
            }

            if ($giftcard->limit_use !== null) {
                if (!is_numeric($giftcard->limit_use) || $giftcard->limit_use <= 0) {
                    abort(500, __('The gift card usage limit has been reached'));
                }
            }

            $usedUserIds = $giftcard->used_user_ids ? json_decode($giftcard->used_user_ids, true) : [];
            if (!is_array($usedUserIds)) {
                $usedUserIds = [];
            }

            if (in_array($user->id, $usedUserIds)) {
                abort(500, __('The gift card has already been used by this user'));
            }

            $usedUserIds[] = $user->id;
            $giftcard->used_user_ids = json_encode($usedUserIds);

            switch ($giftcard->type) {
                case 1:
                    $baseCurrency = (new CurrencyRateService())->getBusinessBaseCurrency();
                    if (!(new UserService())->addBalance($user->id, $giftcard->value, $baseCurrency)) {
                        DB::rollBack();
                        abort(500, __('Operation failed'));
                    }
                    $user = User::find($user->id);
                    break;
                case 2:
                    if ($user->expired_at !== null) {
                        if ($user->expired_at <= $currentTime) {
                            $user->expired_at = $currentTime + $giftcard->value * 86400;
                        } else {
                            $user->expired_at += $giftcard->value * 86400;
                        }
                    } else {
                        abort(500, __('Not suitable gift card type'));
                    }
                    break;
                case 3:
                    $user->transfer_enable += $giftcard->value * 1073741824;
                    break;
                case 4:
                    $user->u = 0;
                    $user->d = 0;
                    break;
                case 5:
                    if ($user->plan_id == null || ($user->expired_at !== null && $user->expired_at < $currentTime)) {
                        $plan = Plan::where('id', $giftcard->plan_id)->first();
                        $user->plan_id = $plan->id;
                        $user->group_id = $plan->group_id;
                        $user->transfer_enable = $plan->transfer_enable * 1073741824;
                        $user->device_limit = $plan->device_limit;
                        $user->u = 0;
                        $user->d = 0;
                        if($giftcard->value == 0) {
                            $user->expired_at = null;
                        } else {
                            $user->expired_at = $currentTime + $giftcard->value * 86400;
                        }
                    } else {
                        abort(500, __('Not suitable gift card type'));
                    }
                    break;
                default:
                    abort(500, __('Unknown gift card type'));
            }

            if ($giftcard->limit_use !== null) {
                $giftcard->limit_use -= 1;
            }

            if (!$user->save() || !$giftcard->save()) {
                throw new \Exception(__('Save failed'));
            }

            DB::commit();

            return response([
                'data' => true,
                'type' => $giftcard->type,
                'value' => $giftcard->value
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            abort(500, $e->getMessage());
        }
    }

    public function info(Request $request)
    {
        $user = User::where('id', $request->user['id'])
            ->select([
                'email',
                'transfer_enable',
                'device_limit',
                'last_login_at',
                'created_at',
                'banned',
                'auto_renewal',
                'remind_expire',
                'remind_traffic',
                'expired_at',
                'commission_balance',
                'plan_id',
                'discount',
                'commission_rate',
                'telegram_id',
                'language',
                'uuid'
            ])
            ->first();
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $user['avatar_url'] = 'https://cravatar.cn/avatar/' . md5($user->email) . '?s=64&d=identicon';
        $userService = new UserService();
        $user['wallets'] = $userService->getUserWalletsRaw($request->user['id']);
        $baseCurrency = (new CurrencyRateService())->getBusinessBaseCurrency();
        $user['balance'] = $userService->getWalletBalanceByCurrency($request->user['id'], $baseCurrency);
        $user['balance_currency'] = $baseCurrency;
        $user['tier'] = $this->buildTierInfo((int) $request->user['id']);

        return response([
            'data' => $user
        ]);
    }

    private function buildTierInfo(int $userId): array
    {
        $defaultTier = [
            'key' => 'member',
            'level' => 1,
            'points' => 0,
            'next_tier_key' => null,
            'next_points_required' => null,
            'points_to_next_tier' => 0,
        ];

        if (!Schema::hasTable('v2_tiers') || !Schema::hasTable('v2_user_points')) {
            return $defaultTier;
        }

        $userPoint = DB::table('v2_user_points')->where('user_id', $userId)->first();
        $points = (int) optional($userPoint)->points;
        $currentTierId = (int) optional($userPoint)->tier_id;

        $currentTier = null;
        if ($currentTierId > 0) {
            $currentTier = DB::table('v2_tiers')->where('id', $currentTierId)->first();
        }
        if (!$currentTier) {
            $currentTier = DB::table('v2_tiers')->orderBy('level', 'asc')->first();
        }
        if (!$currentTier) {
            $defaultTier['points'] = $points;
            return $defaultTier;
        }

        $nextTier = DB::table('v2_tiers')
            ->where('level', '>', (int) $currentTier->level)
            ->orderBy('level', 'asc')
            ->first();

        return [
            'key' => (string) $currentTier->name,
            'level' => (int) $currentTier->level,
            'points' => $points,
            'next_tier_key' => $nextTier ? (string) $nextTier->name : null,
            'next_points_required' => $nextTier ? (int) $nextTier->points_required : null,
            'points_to_next_tier' => $nextTier ? max((int) $nextTier->points_required - $points, 0) : 0,
        ];
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
                'u',
                'd',
                'transfer_enable',
                'device_limit',
                'email',
                'uuid'
            ])
            ->first();
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        if ($user->plan_id) {
            $user['plan'] = Plan::find($user->plan_id);
            if (!$user['plan']) {
                abort(500, __('Subscription plan does not exist'));
            }
        }

        //统计在线设备
        $countalive = 0;
        $ips_array = Cache::get('ALIVE_IP_USER_' . $request->user['id']);
        if ($ips_array) {
            $countalive = $ips_array['alive_ip'];
        }
        $user['alive_ip'] = $countalive;

        $user['subscribe_url'] = Helper::getSubscribeUrl($user['token']);

        $userService = new UserService();
        $quotaPackageService = new QuotaPackageService();
        $usedBytes = (int) $user['u'] + (int) $user['d'];
        $baseQuotaBytes = $quotaPackageService->getCurrentBaseQuotaBytes($user);
        $packageTotalBytes = $quotaPackageService->getTotalBytes((int) $user['id']);
        $packageUsedBytes = $quotaPackageService->getUsedBytes((int) $user['id']);
        $packageRemainingBytes = $quotaPackageService->getRemainingBytes((int) $user['id']);

        $user['total_used_bytes'] = $usedBytes;
        $user['total_remaining_bytes'] = max((int) $user['transfer_enable'] - $usedBytes, 0);
        $user['subscription_quota_total_bytes'] = $baseQuotaBytes;
        $user['subscription_quota_used_bytes'] = min($usedBytes, $baseQuotaBytes);
        $user['subscription_quota_remaining_bytes'] = max($baseQuotaBytes - $user['subscription_quota_used_bytes'], 0);
        $user['quota_package_total_bytes'] = $packageTotalBytes;
        $user['quota_package_used_bytes'] = $packageUsedBytes;
        $user['quota_package_remaining_bytes'] = $packageRemainingBytes;
        $user['has_quota_package'] = $packageTotalBytes > 0 ? 1 : 0;

        $user['reset_day'] = $userService->getResetDay($user);
        $user['allow_new_period'] = config('v2board.allow_new_period', 0);
        return response([
            'data' => $user
        ]);
    }

    public function unbindTelegram(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        if (!$user->update(['telegram_id' => null])) {
            abort(500, __('Unbind telegram failed'));
        }
        return response([
            'data' => true
        ]);
    }

    public function resetSecurity(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        $user->uuid = Helper::guid(true);
        $user->token = Helper::guid();
        if (!$user->save()) {
            abort(500, __('Reset failed'));
        }
        return response([
            'data' => Helper::getSubscribeUrl($user['token'])
        ]);
    }

    public function update(UserUpdate $request)
    {
        $updateData = $request->only([
            'auto_renewal',
            'remind_expire',
            'remind_traffic',
            'language'
        ]);

        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }

        if (array_key_exists('language', $updateData) && $updateData['language'] !== null) {
            $localeService = new LocaleService();
            $resolvedLocale = $localeService->resolveToSupported($updateData['language']);
            if (!$resolvedLocale) {
                abort(500, __('Unsupported language'));
            }
            $updateData['language'] = $resolvedLocale;
        }

        try {
            $user->update($updateData);
        } catch (\Exception $e) {
            abort(500, __('Save failed'));
        }

        return response([
            'data' => true
        ]);
    }

    public function transfer(UserTransfer $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }
        if ($request->input('transfer_amount') > $user->commission_balance) {
            abort(500, __('Insufficient commission balance'));
        }
        $currencyRateService = new CurrencyRateService();
        $commissionCurrency = $currencyRateService->normalizeCurrency($user->commission_currency ?: $currencyRateService->getBusinessBaseCurrency());

        DB::beginTransaction();
        $order = new Order();
        $orderService = new OrderService($order);
        $order->user_id = $request->user['id'];
        $order->plan_id = 0;
        $order->period = 'deposit';
        $order->trade_no = Helper::generateOrderNo();
        $order->pricing_currency = $commissionCurrency;
        $order->total_amount = $request->input('transfer_amount');

        $orderService->setOrderType($user);
        $orderService->setInvite($user);

        $user->commission_balance = $user->commission_balance - $request->input('transfer_amount');
        if (!(new UserService())->addBalance($user->id, (int)$request->input('transfer_amount'), $commissionCurrency)) {
            DB::rollback();
            abort(500, __('transfer failed'));
        }
        $order->status = 3;
        $order->total_amount = 0;
        $order->surplus_amount = $request->input('transfer_amount');
        $order->callback_no = '佣金划转 Commission transfer';
        if (!$order->save()||!$user->save()) {
            DB::rollback();
            abort(500, __('Transfer failed'));
        }

        DB::commit();

        return response([
            'data' => true
        ]);
    }

    public function getQuickLoginUrl(Request $request)
    {
        $user = User::find($request->user['id']);
        if (!$user) {
            abort(500, __('The user does not exist'));
        }

        $code = Helper::guid();
        $key = CacheKey::get('TEMP_TOKEN', $code);
        Cache::put($key, $user->id, 60);
        $redirect = '/#/login?verify=' . $code . '&redirect=' . ($request->input('redirect') ? $request->input('redirect') : 'dashboard');
        if (config('v2board.app_url')) {
            $url = config('v2board.app_url') . $redirect;
        } else {
            $url = url($redirect);
        }
        return response([
            'data' => $url
        ]);
    }

    public function getRecentLoginLogs(Request $request)
    {
        $userId = (int) $request->user['id'];
        $data = LoginLog::query()
            ->where('user_id', $userId)
            ->where('is_success', 1)
            ->select(['created_at as login_at', 'ip'])
            ->orderBy('created_at', 'desc')
            ->limit(5)
            ->get();

        return response([
            'data' => $data,
        ]);
    }

    public function getRecent24hConnectionLogs(Request $request)
    {
        $userId = (int) $request->user['id'];
        $from = time() - 86400;
        $data = UserConnectionLog::query()
            ->where('user_id', $userId)
            ->where('connected_at', '>=', $from)
            ->select(['connected_at', 'ip'])
            ->orderBy('connected_at', 'desc')
            ->get();

        return response([
            'data' => $data,
        ]);
    }
}
