<?php
namespace App\Support;

final class Branding
{
    public static function name($name = null): string
    {
        $value = is_string($name) ? trim($name) : '';
        return $value === '' || preg_match('/^(?:v2board|v2boad)$/i', $value) ? 'FastAI' : $value;
    }
}
