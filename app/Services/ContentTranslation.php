<?php
namespace App\Services;

/** Shared fallback policy for administrator-authored content. Never persists translations. */
final class ContentTranslation
{
    public static function candidates(?string $locale): array
    {
        $language = ProductMail::language(trim((string) $locale));
        $result = $language ? [$language] : [];
        if ($language === 'zh-CN') $result[] = 'zh-TW';
        if ($language === 'zh-TW') $result[] = 'zh-CN';
        $result[] = 'en-US';
        return array_values(array_unique($result));
    }

    public static function field(array $translations, string $field, string $source, ?string $locale, ?string $sourceLanguage = null): string
    {
        foreach (self::candidates($locale) as $candidate) {
            $value = $translations[$candidate][$field] ?? null;
            if (is_string($value) && trim($value) !== '') return $value;
            if ($candidate === ProductMail::language($sourceLanguage) && trim($source) !== '') return $source;
        }
        return $source;
    }

    /** Select complete documents together, so headings and bodies use the same language. */
    public static function document(array $translations, array $source, ?string $locale, ?string $sourceLanguage = null): array
    {
        foreach (self::candidates($locale) as $candidate) {
            $variant = $translations[$candidate] ?? [];
            $complete = true;
            foreach (array_keys($source) as $field) {
                if (!is_string($variant[$field] ?? null) || trim($variant[$field]) === '') $complete = false;
            }
            if ($complete) return ['language' => $candidate, 'values' => $variant];
            if ($candidate === ProductMail::language($sourceLanguage)) return ['language' => $candidate, 'values' => $source];
        }
        return ['language' => ProductMail::language($sourceLanguage) ?: ProductMail::language($locale) ?: 'en-US', 'values' => $source];
    }
}
