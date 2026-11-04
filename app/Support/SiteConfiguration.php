<?php
namespace App\Support;

use Illuminate\Contracts\Foundation\Application;

final class SiteConfiguration
{
    /** All newly saved site settings use the current filename. */
    public static function path(): string
    {
        return config_path('fastai.php');
    }

    public static function withWriteLock(callable $operation): mixed
    {
        $path = self::path();
        $lock = @fopen($path.'.lock', 'c');
        abort_if($lock === false, 500, '无法锁定站点配置。');
        try {
            abort_unless(flock($lock, LOCK_EX), 500, '无法锁定站点配置。');
            return $operation($path);
        } finally {
            fclose($lock);
        }
    }

    public static function readPath(): string
    {
        $current = self::path();
        if (is_file($current)) return $current;
        $legacy = config_path('v2board.php');
        return is_file($legacy) ? $legacy : $current;
    }

    /** A present empty current file is authoritative; never merge retired keys back. */
    public static function read(): ?array
    {
        $path = self::readPath();
        if (!is_file($path)) return null;
        if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
        $settings = require $path;
        if (!is_array($settings)) throw new \UnexpectedValueException('Site configuration must return an array.');
        return $settings;
    }

    public static function install(Application $app): void
    {
        $items = $app->make('config')->all();
        // Older releases cached the public signing loader under the current site name.
        // Never reinterpret an existing private file or a settings tree with other keys.
        if ($app->configurationIsCached() && !is_file(self::path())
            && is_array($items['fastai'] ?? null)
            && array_keys($items['fastai']) === ['entrypoint_signing_seed']) {
            if (!array_key_exists('entrypoint-signing', $items)) {
                $items['entrypoint-signing'] = $items['fastai'];
            }
            unset($items['fastai']);
            // The short-lived conflicting release could also cache only the public seed.
            if (!array_key_exists('v2board', $items) && ($legacy = self::read()) !== null) {
                $items['v2board'] = $legacy;
            }
        }
        $app->instance('config', new SiteConfigurationRepository($items));
    }
}
