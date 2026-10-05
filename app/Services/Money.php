<?php
namespace App\Services;
final class Money {
    public const CURRENCY='CNY';
    public static function format($minor): string { return self::CURRENCY.' '.number_format((int)$minor/100,2,'.',','); }
}
