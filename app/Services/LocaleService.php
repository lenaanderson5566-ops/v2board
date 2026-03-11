<?php

namespace App\Services;

class LocaleService
{
    private $fallbackLocale;

    public function __construct()
    {
        $this->fallbackLocale = $this->normalize((string) config('app.fallback_locale', 'zh-CN')) ?: 'zh-CN';
    }

    public function getSupportedLocales(): array
    {
        $locales = [];
        foreach (glob(resource_path('lang/*.json')) as $file) {
            $locale = basename($file, '.json');
            $normalized = $this->normalize($locale);
            if ($normalized) {
                $locales[$normalized] = true;
            }
        }

        $appLocale = $this->normalize((string) config('app.locale', ''));
        if ($appLocale) {
            $locales[$appLocale] = true;
        }
        $locales[$this->fallbackLocale] = true;

        return array_keys($locales);
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

