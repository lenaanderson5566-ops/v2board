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
        $app->instance('config', new SiteConfigurationRepository($app->make('config')->all()));
    }
}
