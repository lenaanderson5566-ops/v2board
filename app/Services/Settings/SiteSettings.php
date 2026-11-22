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
use App\Support\SubscriptionPath;
use Illuminate\Container\Container;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use RuntimeException;
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
        SubscriptionPath::validateSettings($config, $changes);
        if (!empty($config['passkey_enable']) && (array_key_exists('passkey_enable', $changes) || array_key_exists('app_url', $changes))) {
            $passkeys = app(PasskeyService::class);
            abort_unless($passkeys->available(), 409, '请先通过更新流程安装 Passkey 数据表和依赖。');
            $passkeys->assertConfigured((string) ($config['app_url'] ?? ''));
        }
        MailSettings::validate($config);
        if (isset($changes['fastai_entrypoints'])) {
            $config['fastai_entrypoints_version'] = max((int) ($config['fastai_entrypoints_version'] ?? 1) + 1, (int) floor(microtime(true) * 1000));
        }

        self::publish($path, $config);
        return $config;
    }

    private static function publish(string $path, array $config): void
    {
        $application = app();
        $cachePath = $application->getCachedConfigPath();
        try {
            $previous = self::snapshot($path);
            $previousCache = self::snapshot($cachePath);
            $mode = $previous['mode'] ?? self::snapshot(SiteConfiguration::readPath())['mode'] ?? 0640;
        } catch (Throwable) {
            abort(500, '无法备份当前站点配置或配置缓存，设置未保存。');
        }

        $content = '<?php return '.var_export($config, true).';'.PHP_EOL;
        $stage = 'write';
        try {
            File::replace($path, $content, $mode);
            if (File::get($path) !== $content) {
                throw new RuntimeException('Configuration file does not match the saved settings.');
            }
            $stage = 'cache';
            self::invalidateOpcodeCache($path);
            self::invalidateOpcodeCache($cachePath);
            try {
                $status = Artisan::call('config:cache');
            } finally {
                // The cache command bootstraps a fresh application to read the file.
                if (Container::getInstance() !== $application || Facade::getFacadeApplication() !== $application) {
                    Container::setInstance($application);
                    Facade::clearResolvedInstances();
                    Facade::setFacadeApplication($application);
                }
            }
            if ($status !== 0) {
                throw new RuntimeException('Configuration cache command failed.');
            }
            self::invalidateOpcodeCache($cachePath);
        } catch (Throwable $error) {
            $restored = true;
            foreach ([[$path, $previous], [$cachePath, $previousCache]] as [$file, $snapshot]) {
                try {
                    self::restore($file, $snapshot);
                } catch (Throwable) {
                    $restored = false;
                }
            }
            Log::error('Site settings publication failed', [
                'stage' => $stage,
                'exception_class' => $error::class,
                'restored' => $restored,
            ]);
            abort_unless($restored, 500, '设置发布失败，未能完全恢复先前配置，请检查服务器日志。');
            abort(500, $stage === 'write' ? '修改失败' : '配置缓存刷新失败，已恢复先前设置。');
        }
    }

    private static function snapshot(string $path): ?array
    {
        clearstatcache(true, $path);
        $linked = is_link($path);
        if (!$linked && !file_exists($path)) {
            return null;
        }

        $target = realpath($path);
        $link = $linked ? readlink($path) : null;
        $mode = is_file($path) ? fileperms($path) : false;
        if ($target === false || $mode === false || $link === false) {
            throw new RuntimeException('Unable to read configuration file metadata.');
        }
        return ['target' => $target, 'link' => $link, 'mode' => $mode & 0777, 'bytes' => File::get($target)];
    }

    private static function restore(string $path, ?array $previous): void
    {
        clearstatcache(true, $path);
        if ($previous === null) {
            if ((file_exists($path) || is_link($path)) && !File::delete($path)) {
                throw new RuntimeException('Unable to remove unpublished configuration file.');
            }
        } else {
            $target = $previous['target'];
            $current = self::snapshot($target);
            if (($current['bytes'] ?? null) !== $previous['bytes']) {
                File::replace($target, $previous['bytes'], $previous['mode']);
            } elseif (($current['mode'] ?? null) !== $previous['mode'] && !chmod($target, $previous['mode'])) {
                throw new RuntimeException('Unable to restore configuration file permissions.');
            }
            if ($previous['link'] !== null && (!is_link($path) || readlink($path) !== $previous['link'])) {
                if (((file_exists($path) || is_link($path)) && !File::delete($path)) || !symlink($previous['link'], $path)) {
                    throw new RuntimeException('Unable to restore configuration link.');
                }
            }
            self::invalidateOpcodeCache($target);
        }
        if (self::snapshot($path) !== $previous) {
            throw new RuntimeException('Restored configuration file does not match its backup.');
        }
        self::invalidateOpcodeCache($path);
    }

    private static function invalidateOpcodeCache(string $path): void
    {
        clearstatcache(true, $path);
        if (function_exists('opcache_is_script_cached') && opcache_is_script_cached($path) && !opcache_invalidate($path, true)) {
            throw new RuntimeException('Unable to invalidate cached configuration code.');
        }
    }
}
