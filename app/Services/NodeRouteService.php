<?php
namespace App\Services;

use App\Models\ServerRoute;
use Illuminate\Validation\ValidationException;

class NodeRouteService {
    public static function fail(string $message): void {
        throw ValidationException::withMessages(['route_id'=>$message]);
    }
    public static function selected(array $ids, string $backend) {
        $ids = array_map('intval', $ids);
        if (strlen(json_encode($ids)) > 255) self::fail('所选路由数量超出节点存储限制');
        $routes = ServerRoute::where('backend', $backend)->whereIn('id', $ids)->get()->keyBy('id');
        if ($routes->count() !== count(array_unique($ids))) self::fail('所选路由不存在或不属于当前节点内核');
        return collect($ids)->unique()->map(fn($id) => $routes[$id])->values();
    }
    public static function native($routes): ?array {
        $native = $routes->where('action', 'sing_box');
        if ($native->isEmpty()) return null;
        if ($native->count() !== $routes->count()) self::fail('sing-box 原生规则不能与旧格式兼容规则混选，请先在路由管理中转换旧规则');
        $result = [];
        foreach ($native as $route) $result = self::merge($result, $route->sing_box ?? []);
        V2boxFeatures::validate($result, true);
        return $result ?: null;
    }
    private static function merge(array $left, array $right, string $path = ''): array {
        $lists = ['outbounds','dns.servers','dns.rules','route.rules','route.rule_set'];
        foreach ($right as $key => $value) {
            $at = $path === '' ? $key : $path.'.'.$key;
            if (!array_key_exists($key, $left)) { $left[$key] = $value; continue; }
            if (in_array($at, $lists, true)) {
                foreach ($value as $item) {
                    if (in_array($at, ['outbounds','dns.servers','route.rule_set'], true)) {
                        $existing = collect($left[$key])->first(fn($v) => ($v['tag'] ?? null) === ($item['tag'] ?? null));
                        if ($existing !== null) {
                            if ($existing != $item) self::fail('所选规则存在重复且不同的标签：'.$at.'.'.($item['tag'] ?? ''));
                            continue;
                        }
                    }
                    $left[$key][] = $item;
                }
            } elseif (in_array($at, ['dns','route'], true)) {
                $left[$key] = self::merge($left[$key], $value, $at);
            } elseif ($left[$key] != $value) {
                self::fail('所选规则设置冲突：'.$at);
            }
        }
        return $left;
    }
    public static function forNode($node): ?array {
        return self::native(self::selected($node->route_id ?? [], 'v2box'));
    }
}
