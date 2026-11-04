<?php

namespace App\Services\Actions\Passport;


use App\Http\Requests\Passport\AuthForget;
use App\Http\Requests\Passport\AuthLogin;
use App\Http\Requests\Passport\AuthRegister;
use App\Services\EmailAddress;
use App\Services\EmailInvitationService;
use App\Models\Plan;
use App\Models\User;
use App\Services\AuthService;
use App\Services\RiskLogService;
use App\Utils\CacheKey;
use App\Utils\Dict;
use App\Utils\Helper;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AuthActions
{
    public function register(AuthRegister $request)
    {
        $email = $request->input('email');
        if ((int)config('fastai.email_whitelist_enable', 0)) {
            if (!Helper::emailSuffixVerify(
                $request->input('email'),
                config('fastai.email_whitelist_suffix', Dict::EMAIL_WHITELIST_SUFFIX_DEFAULT))
            ) {
                abort(request()->is('api/v10/*') ? 409 : 500, __('Email suffix is not in the Whitelist'));
            }
        }
        if ((int)config('fastai.email_gmail_limit_enable', 0) && EmailAddress::isGmailAlias($email)) {
            abort($request->is('api/v10/*') ? 409 : 500, __('Gmail alias is not supported'));
        }
        if ((int)config('fastai.stop_register', 0)) {
            abort(request()->is('api/v10/*') ? 409 : 500, __('Registration has closed'));
        }
        if ((int)config('fastai.invite_force', 0)) {
            if (empty($request->input('invitation'))) {
                abort(422, __('An email invitation is required to register.'));
            }
        }
        if ((int)config('fastai.email_verify', 0)) {
            \App\Services\RegistrationEmailVerification::verify($email, $request->input('email_code'), $request->is('api/v10/*'));
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

        $user = $this->persistRegistration($request, $user);
        if ((int)config('fastai.email_verify', 0)) {
            \App\Services\RegistrationEmailVerification::consume($email);
        }

        $user->last_login_at = time();
        $user->last_login_ip = $this->encodeIp($request->ip());
        $user->save();

        try {
            (new \App\Services\InvitationReviewService())->record($user, $request);
        } catch (\Throwable $exception) {
            \Illuminate\Support\Facades\Log::warning('Registration review evidence unavailable');
        }
        $authService = new AuthService($user);

        return response()->json([
            'data' => $authService->generateAuthData($request)
        ]);
    }

    private function persistRegistration(AuthRegister $request, User $user): User
    {
        $failureStatus = $request->is('api/v10/*') ? 409 : 500;
        $trialPlanId = (int)config('fastai.try_out_plan_id', 0);
        $persist = function () use ($request, $user, $failureStatus, $trialPlanId) {
            if ($trialPlanId > 0) {
                $plan = Plan::query()->sharedLock()->find($trialPlanId);
                if ($plan) {
                    $user->transfer_enable = $plan->transfer_enable * 1073741824;
                    $user->device_limit = $plan->device_limit;
                    $user->plan_id = $plan->id;
                    $user->group_id = $plan->group_id;
                    $user->expired_at = time() + (config('fastai.try_out_hour', 1) * 3600);
                    $user->speed_limit = $plan->speed_limit;
                }
            }
            if ($request->filled('invitation')) {
                return (new EmailInvitationService())->register($request->input('invitation'), $user->email, function ($inviterId) use ($user, $failureStatus) {
                    $user->invite_user_id = $inviterId;
                    abort_unless($user->save(), $failureStatus, __('Register failed'));
                    return $user;
                });
            }
            abort_unless($user->save(), $failureStatus, __('Register failed'));
            return $user;
        };
        if (!(int)config('fastai.register_limit_by_ip_enable', 0)) {
            return $trialPlanId > 0 ? DB::transaction($persist) : $persist();
        }

        $key = CacheKey::get('REGISTER_IP_RATE_LIMIT', $request->ip());
        $limit = max(1, min(10000, (int)config('fastai.register_limit_count', 3)));
        $minutes = max(1, min(525600, (int)config('fastai.register_limit_expire', 60)));
        try {
            return Cache::lock($key.':lock', 120)->block(1, function () use ($key, $limit, $minutes, $persist, $failureStatus) {
                $count = (int)Cache::get($key, 0);
                abort_if($count >= $limit, $failureStatus, __('Register frequently, please try again after :minute minute', [
                    'minute' => $minutes,
                ]));
                return DB::transaction(function () use ($persist, $key, $count, $minutes) {
                    $user = $persist();
                    abort_unless(Cache::put($key, $count + 1, $minutes * 60), 503, __('Register failed'));
                    return $user;
                });
            });
        } catch (LockTimeoutException $exception) {
            abort(429, __('Too many requests, please try again later.'), ['Retry-After'=>'1']);
        }
    }

    public function login(AuthLogin $request)
    {
        $email = \App\Services\EmailAddress::key($request->input('email'));
        $password = $request->input('password');
        $riskLogService = new RiskLogService();
        $limitEmail = strtolower(trim($email));

        if ((int)config('fastai.password_limit_enable', 1)) {
            $passwordErrorCount = (int)Cache::get(CacheKey::get('PASSWORD_ERROR_LIMIT', $limitEmail), 0);
            if ($passwordErrorCount >= (int)config('fastai.password_limit_count', 5)) {
                abort(request()->is('api/v10/*') ? 429 : 500, __('There are too many password errors, please try again after :minute minutes.', [
                    'minute' => config('fastai.password_limit_expire', 60)
                ]));
            }
        }

        $user = \App\Services\EmailAddress::find($email);
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
            if ((int)config('fastai.password_limit_enable', 1)) {
                Cache::put(
                    CacheKey::get('PASSWORD_ERROR_LIMIT', $limitEmail),
                    (int)$passwordErrorCount + 1,
                    60 * (int)config('fastai.password_limit_expire', 60)
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

        return \Illuminate\Support\Facades\DB::transaction(function () use ($user, $request, $riskLogService, $email) {
            $locked = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            abort_unless(hash_equals($user->password, $locked->password) && !$locked->banned, 401, __('Incorrect email or password'));
            $user = $locked;
            $challenge = app(\App\Services\MfaService::class)->login($user, $request);
            if ($challenge) return response(['data' => $challenge]);
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
        }, 3);
    }

    public function token2Login(Request $request)
    {
        if ($request->input('verify')) {
            $user = app(\App\Services\SessionAuthorizationCode::class)->exchange(
                \App\Services\SessionAuthorizationCode::BROWSER, $request->input('verify')
            );
            $request->attributes->set('mfa.verifiedUserId', (int) $user->id);
            $request->attributes->set('mfa.verifiedVersion', (int) $user->getRelation('mfaAssurance')->version);
            $request->attributes->set('auth.authenticatedAt', (int)$user->getRelation('mfaAssurance')->authenticatedAt);
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
        app(\App\Services\PasswordRecovery::class)->recover(
            $request->input('email'), $request->input('email_code'), $request->input('password')
        );
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
