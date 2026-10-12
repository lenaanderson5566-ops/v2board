<?php
namespace App\Services;
final class Money {
    public const CURRENCY='CNY';
    public static function parseMinor($value): int {
        if (!is_string($value) && !is_int($value) && !is_float($value)) throw new \InvalidArgumentException('Invalid payment amount');
        $value = (string)$value;
        if (!preg_match('/^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,2}))?$/D', $value, $parts)) throw new \InvalidArgumentException('Invalid payment amount');
        return (int)$parts[1] * 100 + (int)str_pad($parts[2] ?? '', 2, '0');
    }
    public static function format($minor): string { return self::CURRENCY.' '.number_format((int)$minor/100,2,'.',','); }
}
