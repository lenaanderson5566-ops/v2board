<?php

namespace App\Support;

final class AdminPath
{
    public static function resolve(): mixed
    {
        return config('fastai.secure_path', config('fastai.frontend_admin_path', hash('crc32b', config('app.key'))));
    }
}
