<?php
namespace Tests\Support;

final class Assertions
{
    public static function counter(int &$count): \Closure
    {
        return static function ($condition, string $message) use (&$count): void {
            if (!$condition) throw new \RuntimeException($message);
            $count++;
        };
    }
}
