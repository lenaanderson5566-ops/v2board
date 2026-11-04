<?php

namespace App\Services;

use App\Models\User;

final class EmailAddress
{
    public static function isGmailAlias(string $email): bool
    {
        $email = trim($email);
        $separator = strrpos($email, '@');
        if ($separator === false) return false;
        $domain = strtolower(substr($email, $separator + 1));
        $local = substr($email, 0, $separator);
        return in_array($domain, ['gmail.com', 'googlemail.com'], true) && strpbrk($local, '.+') !== false;
    }

    public static function key(string $email): string
    {
        $email = trim($email);
        $separator = strrpos($email, '@');
        if ($separator === false || $separator === 0) abort(422, __('Email format is incorrect'));
        $domain = substr($email, $separator + 1);
        $ascii = idn_to_ascii($domain, IDNA_NONTRANSITIONAL_TO_ASCII | IDNA_USE_STD3_RULES | IDNA_CHECK_BIDI | IDNA_CHECK_CONTEXTJ, INTL_IDNA_VARIANT_UTS46, $info);
        if ($ascii === false || ($info['errors'] ?? 0) !== 0) abort(422, __('Email format is incorrect'));

        // Preserve the existing ASCII case-insensitive policy, but never fold accents,
        // remove local-part dots/plus tags, or use the database collation as identity.
        return strtolower(substr($email, 0, $separator)).'@'.strtolower($ascii);
    }

    public static function find(string $email): ?User
    {
        $key = self::key($email);
        $separator = strrpos($key, '@');
        $unicodeDomain = idn_to_utf8(substr($key, $separator + 1), IDNA_NONTRANSITIONAL_TO_UNICODE, INTL_IDNA_VARIANT_UTS46);
        $candidates = array_unique([trim($email), $key, substr($key, 0, $separator + 1).$unicodeDomain]);
        $found = null;
        foreach (User::whereIn('email', $candidates)->get() as $user) {
            if (!hash_equals($key, self::key($user->email))) continue;
            // Legacy data may contain both IDNA spellings. Fail closed on ambiguity.
            if ($found !== null) return null;
            $found = $user;
        }
        return $found;
    }
}
