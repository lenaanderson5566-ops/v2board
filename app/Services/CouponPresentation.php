<?php
namespace App\Services;

final class CouponPresentation
{
    public static function localized(array $terms, ?string $locale = null): array
    {
        $locale = $locale ?? app()->getLocale();
        $translations = $terms['translations'] ?? [];
        $name = ContentTranslation::field($translations, 'name', (string)$terms['name'], $locale, 'zh-CN');
        return [
            'name' => $name,
            'activityTitle' => ContentTranslation::field($translations, 'activityTitle', (string)($terms['activity_title'] ?? ''), $locale, 'zh-CN') ?: $name,
            'activityDescription' => ContentTranslation::field($translations, 'activityDescription', (string)($terms['activity_description'] ?? ''), $locale, 'zh-CN'),
        ];
    }
}
