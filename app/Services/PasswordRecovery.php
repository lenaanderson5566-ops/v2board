<?php

namespace App\Services;

use App\Jobs\SendEmailJob;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class PasswordRecovery
{
    public static function challengeKey(int $userId): string
    {
        // A new purpose-specific namespace deliberately rejects all pre-fix codes.
        return 'PASSWORD_RECOVERY_V1:'.$userId;
    }

    private static function credentialHash(User $user): string
    {
        return hash_hmac('sha256', json_encode([
            $user->email, $user->password, $user->password_algo, $user->password_salt,
        ], JSON_THROW_ON_ERROR), config('app.key'));
    }

    private static function matches($challenge, User $user, string $code): bool
    {
        return is_array($challenge)
            && ($challenge['purpose'] ?? null) === 'password_recovery'
            && ($challenge['userId'] ?? null) === (int)$user->id
            && ($challenge['expiresAt'] ?? 0) > time()
            && ($challenge['email'] ?? null) === $user->email
            && ($challenge['emailKey'] ?? null) === EmailAddress::key($user->email)
            && is_string($challenge['credentialHash'] ?? null)
            && hash_equals($challenge['credentialHash'], self::credentialHash($user))
            && is_string($challenge['codeHash'] ?? null)
            && hash_equals($challenge['codeHash'], hash_hmac('sha256', $code, config('app.key')));
    }

    private static function fail(string $message): void
    {
        abort(request()->is('api/v10/*') ? 409 : 500, __($message));
    }

    public function send(string $email): mixed
    {
        $identity = EmailAddress::key($email);
        $account = EmailAddress::find($email);
        if (!$account) self::fail('This email is not registered in the system');

        return DB::transaction(function () use ($account, $identity) {
            $user = User::whereKey($account->id)->lockForUpdate()->first();
            if (!$user || $user->account_deleted_at || !hash_equals($identity, EmailAddress::key($user->email))) {
                self::fail('This email is not registered in the system');
            }
            $key = self::challengeKey((int)$user->id);
            if (Cache::get($key.':sent')) self::fail('Email verification code has been sent, please request again later');
            if ((int)Cache::get($key.':attempts', 0) >= 3) self::fail('Reset failed, Please try again later');
            $previous = Cache::get($key);
            do {
                $code = (string)random_int(100000, 999999);
                $codeHash = hash_hmac('sha256', $code, config('app.key'));
            } while (is_array($previous) && ($previous['codeHash'] ?? null) === $codeHash);
            $expiresAt = time() + 300;
            $challenge = [
                'purpose'=>'password_recovery', 'userId'=>(int)$user->id,
                'email'=>$user->email, 'emailKey'=>$identity,
                'credentialHash'=>self::credentialHash($user), 'expiresAt'=>$expiresAt,
                'codeHash'=>$codeHash,
            ];
            if (!Cache::put($key, $challenge, 300) || !Cache::put($key.':sent', true, 60)) {
                Cache::forget($key);
                throw new \RuntimeException('Unable to store password recovery challenge');
            }
            try {
                return app(\Illuminate\Contracts\Bus\Dispatcher::class)->dispatch(new SendEmailJob([
                    'email'=>$user->email, 'user_id'=>(int)$user->id, 'recovery_user_id'=>(int)$user->id,
                    'subject'=>config('v2board.app_name', 'V2Board').__('Email verification code'),
                    'template_name'=>'verify', 'language'=>app()->getLocale(), 'expires_at'=>$expiresAt,
                    'template_value'=>['name'=>config('v2board.app_name', 'V2Board'), 'code'=>$code, 'url'=>config('v2board.app_url')],
                ]));
            } catch (\Throwable $error) {
                Cache::forget($key);
                Cache::forget($key.':sent');
                throw $error;
            }
        }, 3);
    }

    public function recover(string $email, string $code, string $password): void
    {
        if (!preg_match('/^[0-9]{6}$/D', $code)) self::fail('Incorrect email verification code');
        $identity = EmailAddress::key($email);
        $account = EmailAddress::find($email);
        if (!$account) self::fail('Incorrect email verification code');

        DB::transaction(function () use ($account, $identity, $code, $password) {
            // Sending, consuming and failed-attempt accounting share the same account lock.
            $user = User::whereKey($account->id)->lockForUpdate()->first();
            if (!$user || $user->account_deleted_at || !hash_equals($identity, EmailAddress::key($user->email))) {
                self::fail('Incorrect email verification code');
            }
            $key = self::challengeKey((int)$user->id);
            $attempts = (int)Cache::get($key.':attempts', 0);
            if ($attempts >= 3) self::fail('Reset failed, Please try again later');
            if (!self::matches(Cache::get($key), $user, $code)) {
                Cache::put($key.':attempts', $attempts + 1, 300);
                self::fail('Incorrect email verification code');
            }
            $user->password = password_hash($password, PASSWORD_DEFAULT);
            $user->password_algo = null;
            $user->password_salt = null;
            if (!$user->save()) self::fail('Reset failed');
            // Consume under the row lock; a concurrent reset must observe the new password state.
            Cache::forget($key);
            (new AuthService($user))->removeAllSession();
        }, 3);
    }

    public static function deliveryIsCurrent(array $params): bool
    {
        $user = User::find($params['recovery_user_id'] ?? 0);
        return $user && !$user->account_deleted_at && $user->email === ($params['email'] ?? null)
            && self::matches(Cache::get(self::challengeKey((int)$user->id)), $user, (string)($params['template_value']['code'] ?? ''));
    }
}
