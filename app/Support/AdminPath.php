<?php

namespace App\Support;

use Illuminate\Support\Arr;

final class AdminPath
{
    public static function resolve(?array $settings = null): mixed
    {
        $settings ??= config('fastai', []);
        return Arr::get($settings, 'secure_path', Arr::get($settings, 'frontend_admin_path', hash('crc32b', config('app.key'))));
    }
}
