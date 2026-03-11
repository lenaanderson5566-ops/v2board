<?php

namespace App\Services;

class LocaleService
{
    private $fallbackLocale;
    private $themeI18nPath;

    public function __construct()
    {
        $this->fallbackLocale = $this->normalize((string) config('app.fallback_locale', 'zh-CN')) ?: 'zh-CN';
        $this->themeI18nPath = public_path('theme/d1/assets/i18n');
    }

    public function getSupportedLocales(): array
    {
        $locales = $this->getThemeI18nLocales();

        $appLocale = $this->normalize((string) config('app.locale', ''));
        if ($appLocale) {
            $locales[$appLocale] = true;
        }
        $locales[$this->fallbackLocale] = true;

        return array_keys($locales);
    }

    private function getThemeI18nLocales(): array
    {
        $locales = [];

        foreach (glob($this->themeI18nPath . '/*.js') as $file) {
            $content = @file_get_contents($file);
            if ($content === false) {
                continue;
            }

            if (!preg_match("/window\\.settings\\.i18n\\[['\"]([^'\"]+)['\"]\\]/", $content, $matches)) {
                continue;
            }

            $normalized = $this->normalize($matches[1]);
            if ($normalized) {
                $locales[$normalized] = true;
            }
        }

        return $locales;
    }

    public function resolveToSupported($locale): ?string
    {
        $normalized = $this->normalize($locale);
        if (!$normalized) {
            return null;
        }

        $supported = $this->getSupportedLocales();
        $lowerMap = [];
        foreach ($supported as $item) {
            $lowerMap[strtolower($item)] = $item;
        }

        $direct = $lowerMap[strtolower($normalized)] ?? null;
        if ($direct) {
            return $direct;
        }

        $langOnly = strtolower(explode('-', $normalized)[0]);
        foreach ($supported as $item) {
            if (strpos(strtolower($item), $langOnly . '-') === 0) {
                return $item;
            }
        }

        return null;
    }

    public function normalize($locale): string
    {
        $raw = str_replace('_', '-', trim((string) $locale));
        if ($raw === '') {
            return '';
        }

        $parts = explode('-', $raw);
        if (count($parts) === 1) {
            return strtolower($parts[0]);
        }

        $language = strtolower(array_shift($parts));
        $regions = array_map(function ($part) {
            return strtoupper($part);
        }, $parts);

        return $language . '-' . implode('-', $regions);
    }

    public function defaultLocale(): string
    {
        return $this->fallbackLocale;
    }
}

