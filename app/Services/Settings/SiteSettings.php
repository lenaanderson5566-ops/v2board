<?php

namespace App\Services\Settings;

use App\Models\Payment;
use App\Models\Plan;
use App\Services\AppleAccountService;
use App\Services\ExchangeRate;
use App\Services\FastaiEntrypoints;
use App\Services\FastaiInstallerService;
use App\Services\FastaiReleaseService;
use App\Services\Mail\MailSettings;
use App\Services\PasskeyService;
use App\Services\TimeZones;
use App\Support\FrontendConfig;
use App\Support\SiteConfiguration;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

final class SiteSettings
{
    /** Persist validated changes using the request's ordered list of settings. */
    public static function save(array $changes, array $settingKeys): void
    {
        if (($changes['new_user_currency'] ?? null) === 'USD') {
            $hasUsdPrice = Plan::where('show', 1)->whereNotNull('usd_prices')->get()
                ->contains(fn (Plan $plan) => collect($plan->usd_prices)->contains(fn ($price) => $price !== null));
            abort_unless($hasUsdPrice, 422, '请先为至少一个在售套餐配置美元价格。');
            $hasPayment = Payment::where('enable', 1)->whereIn('payment', ['EPay', 'Paytaro', 'PaytaroQR', 'StripeCheckout'])->exists();
            abort_unless($hasPayment, 422, '请先启用支付方式。');
            ExchangeRate::snapshot();
        }
        $changes = MailSettings::prepareSecrets($changes);
        $previousTimezone = TimeZones::system();
        if (isset($changes['fastai_entrypoints'])) {
            $changes['fastai_entrypoints'] = FastaiEntrypoints::validate($changes['fastai_entrypoints']);
            app(FastaiEntrypoints::class)->requireVerified($changes['fastai_entrypoints']);
        }
        if (isset($changes['apple_account_url'])) {
            try {
                $changes['apple_account_url'] = AppleAccountService::normalizeOrigin($changes['apple_account_url']);
            } catch (InvalidArgumentException $error) {
                throw ValidationException::withMessages(['apple_account_url' => $error->getMessage()]);
            }
        }
        if (empty($changes['apple_account_token'])) {
            unset($changes['apple_account_token']);
        }

        $config = SiteConfiguration::withWriteLock(fn (string $path) => self::persist($changes, $settingKeys, $path));
        if ($previousTimezone !== ($config['system_timezone'] ?? $previousTimezone)) {
            Log::info('System business time zone changed', [
                'previous_timezone' => $previousTimezone,
                'timezone' => $config['system_timezone'],
            ]);
        }
    }

    private static function persist(array $changes, array $settingKeys, string $path): array
    {
        clearstatcache(true, $path);
        $config = SiteConfiguration::read() ?? config('fastai');
        $trialPlanId = (int) ($changes['try_out_plan_id'] ?? 0);
        if ($trialPlanId !== 0 && !Plan::whereKey($trialPlanId)->exists()) {
            throw ValidationException::withMessages(['try_out_plan_id' => '试用套餐不存在，请刷新后重新选择。']);
        }
        if (array_key_exists('fastai_releases', $changes)) {
            $current = $config['fastai_releases'] ?? [];
            $revision = FastaiReleaseService::catalogRevision($current);
            abort_unless(hash_equals($revision, $changes['fastai_releases_revision'] ?? ''), 409, '发布目录已被修改，请重新加载后核对。');
            FastaiReleaseService::validatePublication($changes['fastai_releases'], FastaiReleaseService::globalMinimum(), $current);
            foreach ($changes['fastai_releases'] as $release) {
                app(FastaiInstallerService::class)->validateRelease($release);
            }
        }
        unset($changes['fastai_releases_revision']);

        $config['custom_footer_html'] = FrontendConfig::footer($config);
        foreach ([
            'frontend_theme', 'frontend_theme_sidebar', 'frontend_theme_header', 'frontend_theme_color', 'frontend_background_url',
            'recaptcha_enable', 'recaptcha_key', 'recaptcha_site_key', 'frontend_theme_google_analytics', 'google_analytics', 'allow_new_period',
        ] as $legacyKey) {
            unset($config[$legacyKey]);
        }
        foreach ($settingKeys as $key) {
            if (array_key_exists($key, $changes)) {
                $config[$key] = $changes[$key];
            }
        }
        foreach (['email_password_encrypted', 'email_announcement_password_encrypted'] as $flag) {
            if (isset($changes[$flag])) {
                $config[$flag] = $changes[$flag];
            }
        }
        if (!empty($config['passkey_enable']) && (array_key_exists('passkey_enable', $changes) || array_key_exists('app_url', $changes))) {
            $passkeys = app(PasskeyService::class);
            abort_unless($passkeys->available(), 409, '请先通过更新流程安装 Passkey 数据表和依赖。');
            $passkeys->assertConfigured((string) ($config['app_url'] ?? ''));
        }
        MailSettings::validate($config);
        if (isset($changes['fastai_entrypoints'])) {
            $config['fastai_entrypoints_version'] = max((int) ($config['fastai_entrypoints_version'] ?? 1) + 1, (int) floor(microtime(true) * 1000));
        }

        $export = var_export($config, true);
        $permissionSource = is_file($path) ? $path : SiteConfiguration::readPath();
        $mode = is_file($permissionSource) ? fileperms($permissionSource) & 0777 : 0640;
        try {
            File::replace($path, "<?php\n return $export ;", $mode);
        } catch (Throwable) {
            abort(500, '修改失败');
        }
        if (function_exists('opcache_get_status') && opcache_get_status(false) !== false && opcache_reset() === false) {
            abort(500, '缓存清除失败，请卸载或检查opcache配置状态');
        }
        Artisan::call('config:cache');
        return $config;
    }
}
