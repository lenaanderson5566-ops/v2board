<?php

namespace App\Services\Actions\Passport;


use App\Http\Requests\Passport\AuthForget;
use App\Http\Requests\Passport\AuthLogin;
use App\Http\Requests\Passport\AuthRegister;
use App\Jobs\SendEmailJob;
use App\Services\EmailInvitationService;
use App\Models\Plan;
use App\Models\User;
use App\Services\AuthService;
use App\Services\RiskLogService;
use App\Utils\CacheKey;
use App\Utils\Dict;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use ReCaptcha\ReCaptcha;

class AuthActions
{
    public function register(AuthRegister $request)
    {
        if ((int)config('v2board.register_limit_by_ip_enable', 0)) {
            $registerCountByIP = Cache::get(CacheKey::get('REGISTER_IP_RATE_LIMIT', $request->ip())) ?? 0;
            if ((int)$registerCountByIP >= (int)config('v2board.register_limit_count', 3)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Register frequently, please try again after :minute minute', [
                    'minute' => config('v2board.register_limit_expire', 60)
                ]));
            }
        }
        if ((int)config('v2board.recaptcha_enable', 0)) {
            $recaptcha = new ReCaptcha(config('v2board.recaptcha_key'));
            $recaptchaResp = $recaptcha->verify($request->input('recaptcha_data'));
            if (!$recaptchaResp->isSuccess()) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Invalid code is incorrect'));
            }
        }
        if ((int)config('v2board.email_whitelist_enable', 0)) {
            if (!Helper::emailSuffixVerify(
                $request->input('email'),
                config('v2board.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT))
            ) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Email suffix is not in the Whitelist'));
            }
        }
        if ((int)config('v2board.email_gmail_limit_enable', 0)) {
            $prefix = explode('@', $request->input('email'))[0];
            if (strpos($prefix, '.') !== false || strpos($prefix, '+') !== false) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Gmail alias is not supported'));
            }
        }
        if ((int)config('v2board.stop_register', 0)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Registration has closed'));
        }
        if ((int)config('v2board.invite_force', 0)) {
            if (empty($request->input('invitation'))) {
                abort(422, __('An email invitation is required to register.'));
            }
        }
        $email = $request->input('email');
        $cacheKeyEmail = is_string($email) ? strtolower(trim($email)) : '';
        if ((int)config('v2board.email_verify', 0)) {
            $inputCode = $request->input('email_code');
            if (!is_string($inputCode) || !preg_match('/^\d{6}$/', $inputCode)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Incorrect email verification code'));
            }
            $cachedCode = Cache::get(CacheKey::get('EMAIL_VERIFY_CODE', $cacheKeyEmail));
            if ($cachedCode === null || $cachedCode === '' || !hash_equals((string)$cachedCode, $inputCode)) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Incorrect email verification code'));
            }
        }
        $password = $request->input('password');
        $exist = User::where('email', $email)->first();
        if ($exist) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Email already exists'));
        }
        $user = new User();
        $user->email = $email;
        $user->language = $request->input('language');
        $user->password = password_hash($password, PASSWORD_DEFAULT);
        $user->uuid = Helper::guid(true);
        $user->token = Helper::guid();
        if ($request->input('invite_code')) abort(410, __('Public invite codes are no longer supported. Use an email invitation.'));

        // try out
        if ((int)config('v2board.try_out_plan_id', 0)) {
            $plan = Plan::find(config('v2board.try_out_plan_id'));
            if ($plan) {
                $user->transfer_enable = $plan->transfer_enable * 1073741824;
                $user->device_limit = $plan->device_limit;
                $user->plan_id = $plan->id;
                $user->group_id = $plan->group_id;
                $user->expired_at = time() + (config('v2board.try_out_hour', 1) * 3600);
                $user->speed_limit = $plan->speed_limit;
            }
        }

        if ($request->filled('invitation')) {
            $user = (new EmailInvitationService())->register($request->input('invitation'), $email, function ($inviterId) use ($user) {
                $user->invite_user_id = $inviterId;
                if (!$user->save()) abort(request()->is('api/v10/*') ? 409 : 500, __('Register failed'));
                return $user;
            });
        } elseif (!$user->save()) abort(request()->is('api/v10/*') ? 409 : 500, __('Register failed'));
        if ((int)config('v2board.email_verify', 0)) {
            Cache::forget(CacheKey::get('EMAIL_VERIFY_CODE', $cacheKeyEmail));
        }

        $user->last_login_at = time();
        $user->last_login_ip = $this->encodeIp($request->ip());
        $user->save();

        if ((int)config('v2board.register_limit_by_ip_enable', 0)) {
            Cache::put(
                CacheKey::get('REGISTER_IP_RATE_LIMIT', $request->ip()),
                (int)$registerCountByIP + 1,
                (int)config('v2board.register_limit_expire', 60) * 60
            );
        }

        $authService = new AuthService($user);

        return response()->json([
            'data' => $authService->generateAuthData($request)
        ]);
    }

    public function login(AuthLogin $request)
    {
        if ((int)config('v2board.recaptcha_enable', 0)) {
            $challenge = $request->input('recaptcha_data');
            if (!is_string($challenge) || $challenge === '') abort(422, __('Invalid code is incorrect'));
            $result = (new ReCaptcha(config('v2board.recaptcha_key')))->verify($challenge, $request->ip());
            if (!$result->isSuccess()) abort(422, __('Invalid code is incorrect'));
        }
        $email = $request->input('email');
        $password = $request->input('password');
        $riskLogService = new RiskLogService();
        $limitEmail = strtolower(trim($email));

        if ((int)config('v2board.password_limit_enable', 1)) {
            $passwordErrorCount = (int)Cache::get(CacheKey::get('PASSWORD_ERROR_LIMIT', $limitEmail), 0);
            if ($passwordErrorCount >= (int)config('v2board.password_limit_count', 5)) {
                abort(request()->is('api/v10/*') ? 429 : 500, __('There are too many password errors, please try again after :minute minutes.', [
                    'minute' => config('v2board.password_limit_expire', 60)
                ]));
            }
        }

        $user = User::where('email', $email)->first();
        if (!$user) {
            $riskLogService->createLoginLog([
                'email' => $email,
                'is_success' => false,
                'reason' => 'user_not_found'
            ]);
            abort(request()->is('api/v10/*') ? 401 : 500, __('Incorrect email or password'));
        }
        if (!Helper::multiPasswordVerify(
            $user->password_algo,
            $user->password_salt,
            $password,
            $user->password)
        ) {
            if ((int)config('v2board.password_limit_enable', 1)) {
                Cache::put(
                    CacheKey::get('PASSWORD_ERROR_LIMIT', $limitEmail),
                    (int)$passwordErrorCount + 1,
                    60 * (int)config('v2board.password_limit_expire', 60)
                );
            }
            $riskLogService->createLoginLog([
                'user_id' => $user->id,
                'email' => $email,
                'is_success' => false,
                'reason' => 'password_error'
            ]);
            abort(request()->is('api/v10/*') ? 401 : 500, __('Incorrect email or password'));
        }

        if ($user->banned) {
            $riskLogService->createLoginLog([
                'user_id' => $user->id,
                'email' => $email,
                'is_success' => false,
                'reason' => 'user_banned'
            ]);
            return response()->json(['message' => __('Your account has been suspended'), 'code' => 'ACCOUNT_BANNED'], $request->is('api/v10/*') ? 403 : 500);
        }

        $riskLogService->createLoginLog([
            'user_id' => $user->id,
            'email' => $email,
            'is_success' => true,
            'reason' => 'success'
        ]);

        // An automatic browser locale must not overwrite an account preference.
        if ($request->filled('language') && ($user->language === null || $request->boolean('language_selected'))) {
            $user->language = $request->input('language');
        }
        $user->last_login_at = time();
        $user->last_login_ip = $this->encodeIp($request->ip());
        $user->save();

        $authService = new AuthService($user);
        return response([
            'data' => $authService->generateAuthData($request)
        ]);
    }

    public function token2Login(Request $request)
    {
        if ($request->input('verify')) {
            $user = app(\App\Services\SessionAuthorizationCode::class)->exchange(
                \App\Services\SessionAuthorizationCode::BROWSER, $request->input('verify')
            );
            $user->last_login_at = time();
            $user->last_login_ip = $this->encodeIp($request->ip());
            $user->save();
            $authService = new AuthService($user);
            return response([
                'data' => $authService->generateAuthData($request)
            ]);
        }
    }

    public function getQuickLoginUrl(Request $request)
    {
        $credential = (string)($request->input('auth_data') ?? $request->header('authorization'));
        return response(['data'=>app(\App\Services\BrowserLoginLink::class)->create($request, $credential)]);
    }

    public function forget(AuthForget $request)
    {
        $email     = $request->input('email');
        $inputCode = $request->input('email_code');
        $password  = $request->input('password');

        if (!is_string($email) || !is_string($inputCode) || !is_string($password)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Incorrect email verification code'));
        }
        if (!preg_match('/^\d{6}$/', $inputCode)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Incorrect email verification code'));
        }

        $cacheKeyEmail         = strtolower(trim($email));
        $forgetRequestLimitKey = CacheKey::get('FORGET_REQUEST_LIMIT', $cacheKeyEmail);
        $forgetRequestLimit    = (int)Cache::get($forgetRequestLimitKey);
        if ($forgetRequestLimit >= 3) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Reset failed, Please try again later'));
        }

        $cachedCode = Cache::get(CacheKey::get('EMAIL_VERIFY_CODE', $cacheKeyEmail));
        if ($cachedCode === null || $cachedCode === '' || !hash_equals((string)$cachedCode, $inputCode)) {
            Cache::put($forgetRequestLimitKey, $forgetRequestLimit + 1, 300);
            abort(request()->is('api/v10/*') ? 409 : 500, __('Incorrect email verification code'));
        }
        $user = User::where('email', $email)->first();
        if (!$user) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('This email is not registered in the system'));
        }
        $user->password      = password_hash($password, PASSWORD_DEFAULT);
        $user->password_algo = null;
        $user->password_salt = null;
        if (!$user->save()) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Reset failed'));
        }
        Cache::forget(CacheKey::get('EMAIL_VERIFY_CODE', $cacheKeyEmail));
        (new AuthService($user))->removeAllSession();
        return response([
            'data' => true
        ]);
    }

    private function encodeIp(?string $ip): ?string
    {
        if (!$ip || !filter_var($ip, FILTER_VALIDATE_IP)) {
            return null;
        }

        return $ip;
    }
}
