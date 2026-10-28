<?php

namespace App\Services;

use App\Services\Mail\ProductMail;

use App\Jobs\SendEmailJob;
use App\Models\User;
use App\Utils\Helper;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, Crypt, DB, Log};

final class MfaService
{
    public const PURPOSES = ['enableEmail', 'disableEmail', 'setupTotp', 'replaceTotp', 'disableTotp', 'recoveryCodes'];

    private function key(string $token): string
    {
        abort_unless(preg_match('/^[a-f0-9]{64}$/D', $token), 422, __('Invalid security challenge.'));
        return 'MFA_CHALLENGE:' . hash('sha256', $token);
    }

    private function binding(Request $request): string
    {
        $browser = $request->attributes->get('browser.session');
        $identity = $browser ? $browser['scope'] . ':' . $browser['id'] : 'native:' . ($request->bearerToken() ?: $request->header('Authorization', ''));
        return hash_hmac('sha256', $identity . ':' . ($request->userAgent() ?? ''), config('app.key'));
    }

    private function limit(string $identity, int $maximum, int $seconds): void
    {
        $key = 'MFA_LIMIT:' . hash('sha256', $identity);
        Cache::lock($key . ':lock', 5)->block(3, function () use ($key, $maximum, $seconds) {
            $attempts = (int) Cache::get($key, 0);
            abort_if($attempts >= $maximum, 429, __('Too many security verification attempts. Please try again later.'));
            Cache::put($key, $attempts + 1, $seconds);
        });
    }

    public function state(int $userId): array
    {
        $row = DB::table('v2_user_mfa')->where('user_id', $userId)->first();
        return ['emailEnabled' => (bool) ($row->email_enabled ?? false), 'totpEnabled' => (bool) ($row->totp_secret ?? false),
            'recoveryCodesRemaining' => count(json_decode($row->recovery_hashes ?? '[]', true) ?: []),
            'enrollmentEnabled' => (bool) config('v2board.mfa_enable', 0)];
    }

    private function row(int $userId)
    {
        DB::table('v2_user_mfa')->insertOrIgnore(['user_id' => $userId]);
        return DB::table('v2_user_mfa')->where('user_id', $userId)->lockForUpdate()->first();
    }

    private function factor($row, string $code, string $method): bool
    {
        if ($method === 'totp' && $row->totp_secret) {
            $step = Totp::match(Crypt::decryptString($row->totp_secret), $code, (int) $row->last_totp_step);
            if ($step === null) return false;
            DB::table('v2_user_mfa')->where('user_id', $row->user_id)->update(['last_totp_step' => $step]);
            return true;
        }
        if ($method === 'recovery' && $row->totp_secret) {
            $hashes = json_decode($row->recovery_hashes ?? '[]', true) ?: [];
            $digest = hash('sha256', strtoupper(str_replace([' ', '-'], '', $code)));
            foreach ($hashes as $index => $hash) {
                if (!hash_equals($hash, $digest)) continue;
                unset($hashes[$index]);
                DB::table('v2_user_mfa')->where('user_id', $row->user_id)->update(['recovery_hashes' => json_encode(array_values($hashes))]);
                return true;
            }
        }
        return false;
    }

    private function issue(User $user, Request $request, array $record): array
    {
        $token = bin2hex(random_bytes(32));
        $record += ['userId' => $user->id, 'binding' => $this->binding($request), 'expiresAt' => time() + 300,
            'emailFingerprint' => hash('sha256', $user->email), 'passwordFingerprint' => hash('sha256', $user->password)];
        Cache::put($this->key($token), $record, 300);
        return ['challengeId' => $token, 'expiresAt' => gmdate('c', $record['expiresAt'])];
    }

    public function login(User $user, Request $request): ?array
    {
        $state = $this->state($user->id);
        if (!$state['totpEnabled'] && !$state['emailEnabled']) return null;
        $this->limit('login:' . $user->id, 10, 300);
        $row = DB::table('v2_user_mfa')->where('user_id', $user->id)->first();
        $methods = $state['totpEnabled'] ? ['totp'] : [];
        if ($state['totpEnabled'] && $state['recoveryCodesRemaining'] > 0) $methods[] = 'recovery';
        if ($state['emailEnabled']) $methods[] = 'email';
        $challenge = $this->issue($user, $request, ['purpose' => 'login', 'version' => (int) $row->version,
            'passkeyHash'=>$request->attributes->get('passkey.credentialHash'),
            'methods' => $methods, 'language' => $request->input('language'), 'languageSelected' => $request->boolean('language_selected')]);
        return $challenge + ['mfaRequired' => true, 'methods' => $methods, 'preferredMethod' => $state['totpEnabled'] ? 'totp' : 'email'];
    }

    private function record(string $token, Request $request): array
    {
        $record = Cache::get($this->key($token));
        abort_unless($record && $record['expiresAt'] > time() && hash_equals($record['binding'], $this->binding($request)), 409, __('Security challenge expired. Please start again.'));
        $user = User::find($record['userId']);
        abort_unless($user && !$user->banned && hash_equals($record['emailFingerprint'], hash('sha256', $user->email)) && hash_equals($record['passwordFingerprint'], hash('sha256', $user->password)), 409, __('Security challenge expired. Please start again.'));
        if ($request->attributes->get('mfa.adminOnly')) abort_unless($user->is_admin, 403, __('Account is disabled.'));
        if ($record['purpose'] !== 'login') {
            $credential = $request->bearerToken() ?: $request->header('Authorization');
            $claims = AuthService::decryptAuthData($credential);
            abort_unless($claims && (int) $claims['id'] === (int) $user->id, 401, __('Unauthenticated.'));
        }
        return $record;
    }

    public function sendEmail(string $token, Request $request): void
    {
        $key = $this->key($token);
        Cache::lock($key . ':lock', 10)->block(5, function () use ($token, $key, $request) {
            $record = $this->record($token, $request);
            abort_unless(($record['emailRequired'] ?? false) || in_array('email', $record['methods'] ?? [], true), 403, __('Email verification is not available.'));
            abort_if(($record['sentAt'] ?? 0) > time() - 60, 429, __('Please wait before requesting another code.'));
            $this->limit('mail:user:' . $record['userId'], 3, 300);
            $this->limit('mail:ip:' . $request->ip(), 20, 300);
            $code = (string) random_int(100000, 999999);
            $record['emailHash'] = hash_hmac('sha256', $code, config('app.key'));
            $record['sentAt'] = time();
            Cache::put($key, $record, max(1, $record['expiresAt'] - time()));
            $user = User::findOrFail($record['userId']);
            SendEmailJob::dispatch(['email' => $user->email, 'subject' => __('Security verification code'),
                'template_name' => 'verify', 'language' => $user->language ?: app()->getLocale(), 'user_id' => $user->id,
                'mfa_challenge_key' => $key, 'expires_at' => $record['expiresAt'], 'template_value' => ['name' => config('v2board.app_name', 'FastAI'), 'code' => $code, 'url' => config('v2board.app_url')]]);
        });
    }

    public function start(User $user, Request $request): array
    {
        $input = $request->validate(['purpose' => 'required|in:' . implode(',', self::PURPOSES), 'password' => 'required|string|max:128',
            'verificationCode' => 'nullable|string|max:40', 'verificationMethod' => 'nullable|in:totp,recovery']);
        abort_if(in_array($input['purpose'], ['enableEmail', 'setupTotp'], true) && !config('v2board.mfa_enable', 0), 403, __('Security settings changed. Please refresh.'));
        $this->limit('settings:' . $user->id, 5, 300);
        abort_unless(Helper::multiPasswordVerify($user->password_algo, $user->password_salt, $input['password'], $user->password), 422, __('Incorrect email or password'));
        // Return failed factor validation outside the transaction so used recovery codes cannot roll back on a later error.
        $authorized = DB::transaction(function () use ($user, $input, $request) {
            $current = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
            abort_unless(!$current->banned && hash_equals($user->password, $current->password), 409, __('Security settings changed. Please start again.'));
            if ($request->attributes->get('mfa.adminOnly')) abort_unless($current->is_admin, 403, __('Account is disabled.'));
            $row = $this->row($user->id);
            $valid = !$row->totp_secret || $this->factor($row, $input['verificationCode'] ?? '', $input['verificationMethod'] ?? 'totp');
            return [$valid, $row];
        }, 3);
        abort_unless($authorized[0], 422, __('Incorrect security verification code.'));
        $row = $authorized[1];
        $purpose = $input['purpose'];
        abort_if(($purpose === 'setupTotp' && $row->totp_secret) || (in_array($purpose, ['replaceTotp', 'disableTotp', 'recoveryCodes'], true) && !$row->totp_secret)
            || ($purpose === 'enableEmail' && $row->email_enabled) || ($purpose === 'disableEmail' && !$row->email_enabled), 409, __('Security settings changed. Please refresh.'));
        $secret = in_array($purpose, ['setupTotp', 'replaceTotp'], true) ? Totp::secret() : null;
        $record = ['purpose' => $purpose, 'version' => (int) $row->version, 'emailRequired' => $purpose === 'enableEmail' || (!$row->totp_secret && (bool) $row->email_enabled),
            'secret' => $secret ? Crypt::encryptString($secret) : null];
        $result = $this->issue($user, $request, $record);
        if ($secret) {
            $issuer = config('v2board.app_name', 'FastAI');
            $result += ['secret' => $secret, 'otpauthUri' => 'otpauth://totp/' . rawurlencode($issuer . ':' . $user->email)
                . '?' . http_build_query(['secret' => $secret, 'issuer' => $issuer, 'algorithm' => 'SHA1', 'digits' => 6, 'period' => 30], '', '&', PHP_QUERY_RFC3986)];
        }
        return $result + ['emailRequired' => $record['emailRequired']];
    }

    private function recovery(): array
    {
        $codes = [];
        for ($index = 0; $index < 10; $index++) $codes[] = strtoupper(implode('-', str_split(bin2hex(random_bytes(16)), 8)));
        return $codes;
    }

    public function finish(string $token, Request $request): array
    {
        $input = $request->validate(['verificationCode' => 'nullable|string|max:40', 'verificationMethod' => 'nullable|in:totp,email,recovery',
            'emailCode' => 'nullable|string|regex:/^\d{6}$/', 'totpCode' => 'nullable|string|regex:/^\d{6}$/']);
        $key = $this->key($token);
        return Cache::lock($key . ':lock', 10)->block(5, function () use ($token, $key, $request, $input) {
            $record = $this->record($token, $request);
            $this->limit('verify:' . $record['userId'], 10, 300);
            $result = DB::transaction(function () use ($record, $request, $input) {
                $user = User::whereKey($record['userId'])->lockForUpdate()->firstOrFail();
                abort_unless(!$user->banned && hash_equals($record['passwordFingerprint'], hash('sha256', $user->password))
                    && hash_equals($record['emailFingerprint'], hash('sha256', $user->email)), 409, __('Security challenge expired. Please start again.'));
                if ($request->attributes->get('mfa.adminOnly')) abort_unless($user->is_admin, 403, __('Account is disabled.'));
                $row = $this->row($user->id);
                abort_unless((int) $row->version === $record['version'], 409, __('Security settings changed. Please start again.'));
                $purpose = $record['purpose'];
                abort_if(in_array($purpose, ['enableEmail', 'setupTotp'], true) && !config('v2board.mfa_enable', 0), 403, __('Security settings changed. Please refresh.'));
                if (!empty($record['passkeyHash'])) abort_unless(config('v2board.passkey_enable',0) && DB::table('v2_passkey')->where('credential_hash',$record['passkeyHash'])->where('user_id',$user->id)->exists(),409,__('Security challenge expired. Please start again.'));
                $email = $purpose === 'login' ? ($input['verificationCode'] ?? '') : ($input['emailCode'] ?? '');
                $validEmail = isset($record['emailHash']) && hash_equals($record['emailHash'], hash_hmac('sha256', $email, config('app.key')));
                if ($purpose === 'login') {
                    $method = $input['verificationMethod'] ?? ($row->totp_secret ? 'totp' : 'email');
                    $valid = in_array($method, $record['methods'], true) && ($method === 'email' ? $validEmail : $this->factor($row, $input['verificationCode'] ?? '', $method));
                    if (!$valid) return null;
                    if ($record['language'] && ($user->language === null || $record['languageSelected'])) $user->language = $record['language'];
                    $user->last_login_at = time();
                    $user->last_login_ip = filter_var($request->ip(), FILTER_VALIDATE_IP) ? $request->ip() : null;
                    $user->save();
                    (new RiskLogService())->createLoginLog(['user_id' => $user->id, 'email' => $user->email, 'is_success' => true, 'reason' => 'success']);
                    $request->attributes->set('mfa.verifiedUserId', (int) $user->id);
                    $request->attributes->set('mfa.verifiedVersion', (int) $row->version);
                    return ['auth' => (new AuthService($user))->generateAuthData($request)];
                }
                if ($record['emailRequired'] && !$validEmail) return null;
                $updates = ['version' => $row->version + 1];
                $codes = [];
                if ($record['secret']) {
                    $step = Totp::match(Crypt::decryptString($record['secret']), $input['totpCode'] ?? '');
                    if ($step === null) return null;
                    $updates += ['totp_secret' => $record['secret'], 'last_totp_step' => $step];
                }
                if (in_array($purpose, ['setupTotp', 'replaceTotp', 'recoveryCodes'], true)) {
                    $codes = $this->recovery();
                    $updates['recovery_hashes'] = json_encode(array_map(fn($code) => hash('sha256', str_replace('-', '', $code)), $codes));
                }
                if ($purpose === 'enableEmail' || $purpose === 'disableEmail') $updates['email_enabled'] = $purpose === 'enableEmail';
                if ($purpose === 'disableTotp') $updates += ['totp_secret' => null, 'recovery_hashes' => null, 'last_totp_step' => -1];
                DB::table('v2_user_mfa')->where('user_id', $user->id)->update($updates);
                (new AuthService($user))->removeAllSession();
                return ['recoveryCodes' => $codes, 'reauthenticationRequired' => true];
            }, 3);
            if ($result === null) {
                Log::warning('Security verification failed', ['userId' => $record['userId'], 'purpose' => $record['purpose']]);
                if ($record['purpose'] === 'login') {
                    $user = User::findOrFail($record['userId']);
                    (new RiskLogService())->createLoginLog(['user_id' => $user->id, 'email' => $user->email, 'is_success' => false, 'reason' => 'mfa_verification_failed']);
                }
                abort(422, __('Incorrect security verification code.'));
            }
            Cache::forget($key);
            if ($record['purpose'] !== 'login') {
                try {
                    $user = User::findOrFail($record['userId']);
                    $copies = require resource_path('lang/mfa.php');
                    $language = ProductMail::language($user->language) ?: app()->getLocale();
                    $copy = $copies[$language] ?? $copies['zh-CN'];
                    SendEmailJob::dispatch(['email' => $user->email, 'language' => $language, 'subject' => $copy['title'],
                        'template_name' => 'notify', 'mail_purpose' => 'transactional', 'template_value' => ['content' => $copy['body']]]);
                } catch (\Throwable $error) {
                    Log::warning('Security notice could not be queued', ['userId' => $record['userId'], 'exceptionClass' => get_class($error)]);
                }
            }
            Log::info('Security verification completed', ['userId' => $record['userId'], 'purpose' => $record['purpose']]);
            return $result;
        });
    }
}
