<?php
namespace App\Support;

class FrontendConfig
{
    public static function footer(): string
    {
        $footer = config('v2board.custom_footer_html');
        if ($footer !== null) return (string) $footer;
        // Preserve the configured HTML when upgrading from the legacy theme.
        $legacyTheme = config('v2board.frontend_theme', 'd1');
        return (string) config("theme.{$legacyTheme}.custom_html", '');
    }
}
