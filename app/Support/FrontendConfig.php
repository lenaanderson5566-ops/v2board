<?php
namespace App\Support;

class FrontendConfig
{
    public static function footer(?array $settings = null): string
    {
        $settings ??= config('fastai', []);
        $footer = $settings['custom_footer_html'] ?? null;
        if ($footer !== null) return (string) $footer;
        // Preserve the configured HTML when upgrading from the legacy theme.
        $legacyTheme = $settings['frontend_theme'] ?? 'd1';
        return (string) config("theme.{$legacyTheme}.custom_html", '');
    }
}
