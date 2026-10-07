<?php
return [
    'secure' => env('BROWSER_COOKIE_SECURE', env('APP_ENV') !== 'local'),
    'user_idle_seconds' => 7 * 86400,
    'admin_idle_seconds' => 12 * 3600,
    'legacy_exchange_until' => env('BROWSER_LEGACY_EXCHANGE_UNTIL', '2026-10-21T00:00:00Z'),
];
