<?php

namespace App\Services;

final class Totp
{
    public static function secret(): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split(random_bytes(20)) as $byte) $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
        $secret = '';
        foreach (str_split($bits, 5) as $part) $secret .= $alphabet[bindec($part)];
        return $secret;
    }

    public static function code(string $secret, int $step): string
    {
        $bits = '';
        foreach (str_split($secret) as $character) {
            $position = strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', $character);
            if ($position === false) throw new \InvalidArgumentException('Invalid TOTP secret');
            $bits .= str_pad(decbin($position), 5, '0', STR_PAD_LEFT);
        }
        $key = '';
        foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $key .= chr(bindec($byte));
        $digest = hash_hmac('sha1', pack('N2', $step >> 32, $step & 0xffffffff), $key, true);
        $offset = ord($digest[19]) & 15;
        $number = unpack('N', substr($digest, $offset, 4))[1] & 0x7fffffff;
        return str_pad((string) ($number % 1000000), 6, '0', STR_PAD_LEFT);
    }

    public static function match(string $secret, string $code, int $after = -1): ?int
    {
        if (!preg_match('/^\d{6}$/D', $code)) return null;
        $step = intdiv(time(), 30);
        foreach ([$step, $step - 1, $step + 1] as $candidate) {
            if ($candidate > $after && hash_equals(self::code($secret, $candidate), $code)) return $candidate;
        }
        return null;
    }
}
