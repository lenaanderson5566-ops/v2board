<?php

namespace App\Support;

use App\Http\Controllers\CustomSubscriptionController;
use Illuminate\Validation\ValidationException;

final class SubscriptionPath
{
    public const V10_BASE = '/api/v10/subscriptions';

    public static function resolve(): ?string
    {
        $path = self::normalized(config('fastai.subscribe_path'));
        if ($path === null || self::conflicts($path, (string) AdminPath::resolve())) {
            return null;
        }
        return $path;
    }

    /** Check both sides of a rename against the settings that will be written under the site lock. */
    public static function validateSettings(array $settings, array $changes): void
    {
        if (!array_key_exists('subscribe_path', $changes) && !array_key_exists('secure_path', $changes)) {
            return;
        }
        $path = self::normalized($settings['subscribe_path'] ?? null);
        if ($path !== null && self::conflicts($path, (string) AdminPath::resolve($settings))) {
            $field = array_key_exists('subscribe_path', $changes) ? 'subscribe_path' : 'secure_path';
            throw ValidationException::withMessages([$field => '自定义订阅路径须为固定路径，且不能与已有入口或接口重合。']);
        }
    }

    private static function normalized(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        $path = '/' . trim($value, '/');
        return $path === '/api/v1/client/subscribe' ? null : $path;
    }

    private static function conflicts(string $path, string $adminPath): bool
    {
        $decoded = rtrim(rawurldecode($path), '/') ?: '/';
        if (in_array($decoded, ['/', '/app', '/' . trim($adminPath, '/')], true)
            || strpbrk($decoded, '{}?#\\') !== false
            || preg_match('~[[:cntrl:]]|/(?:\.|\.\.)(?:/|$)~', $decoded)) {
            return true;
        }

        $routes = app('router')->getRoutes();
        $customAction = CustomSubscriptionController::class . '@subscribe';
        $currentAdmin = trim((string) AdminPath::resolve(), '/');
        $adminPath = trim($adminPath, '/');
        // The registered alias already passed the collision check during route registration.
        if ($adminPath === $currentAdmin && $routes->getByAction($customAction)?->uri() === ltrim($path, '/')) {
            return false;
        }
        foreach ($routes->getRoutes() as $route) {
            if (!in_array('GET', $route->methods(), true) || $route->getActionName() === $customAction) {
                continue;
            }
            $uri = $route->uri();
            $candidate = ltrim($decoded, '/');
            if ($adminPath !== $currentAdmin) {
                if ($uri === $currentAdmin && $route->getActionName() === 'Closure') {
                    continue;
                }
                if (in_array('admin', $route->middleware(), true) && str_starts_with($uri, 'api/v1/' . $currentAdmin . '/')) {
                    if (!str_starts_with($candidate, 'api/v1/' . $adminPath . '/')) {
                        continue;
                    }
                    $candidate = 'api/v1/' . $currentAdmin . substr($candidate, strlen('api/v1/' . $adminPath));
                }
            }
            if ($uri === $candidate) {
                return true;
            }
            // Only compile parameterized routes whose literal prefix could match this alias.
            $prefix = strstr($uri, '{', true);
            if ($prefix !== false && str_starts_with($candidate, rtrim($prefix, '/'))
                && preg_match($route->toSymfonyRoute()->compile()->getRegex(), '/' . $candidate)) {
                return true;
            }
        }
        return false;
    }
}
