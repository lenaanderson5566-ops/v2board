<?php
namespace App\Services;

final class CouponPresentation
{
    public static function localized(array $terms, ?string $locale = null): array
    {
        $language = ProductMail::language($locale ?? app()->getLocale()) ?: 'zh-CN';
        $variant = ($terms['translations'] ?? [])[$language] ?? [];
        $name = trim((string)($variant['name'] ?? '')) ?: (string)$terms['name'];
        return [
            'name' => $name,
            'activityTitle' => trim((string)($variant['activityTitle'] ?? '')) ?: (($terms['activity_title'] ?? null) ?: $name),
            'activityDescription' => trim((string)($variant['activityDescription'] ?? '')) ?: (string)($terms['activity_description'] ?? ''),
        ];
    }
}
