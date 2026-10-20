<?php

namespace App\Services;

/** Node display country names only; GeoIP maintains its own data. */
final class NodeCountryDictionary
{
    public static function all(): array
    {
        static $countries;
        if ($countries === null) {
            $countries = json_decode(file_get_contents(resource_path('client/node-countries.json')), true, 512, JSON_THROW_ON_ERROR);
        }
        $result = app(NodeDictionary::class)->apply('regions', $countries);
        foreach ($result as &$names) {
            foreach (LanguagePreferenceService::SUPPORTED as $language) $names[$language] ??= $names['en-US'];
        }
        unset($names);
        return $result;
    }

    public static function name(?string $code, string $language = 'en-US'): ?string
    {
        $names = self::all()[strtoupper(trim($code ?? ''))] ?? null;
        return $names === null ? null : ($names[$language] ?? $names['en-US']);
    }
}
