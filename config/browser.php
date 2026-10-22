<?php
return [
    'secure' => env('BROWSER_COOKIE_SECURE', env('APP_ENV') !== 'local'),
    'user_idle_seconds' => 7 * 86400,
    'admin_idle_seconds' => 12 * 3600,
];
