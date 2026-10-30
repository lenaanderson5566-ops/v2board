<?php

namespace App\Services;

use App\Models\UserConnectionLog;
use App\Models\UserOnlineSnapshot;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

class OnlineDeviceService
{
    public const FRESH_SECONDS = 100;
    private const LOCK_SECONDS = 120;

    public static function freshWindow(): int
    {
        $interval = max(1, min(86400, (int) config('v2board.server_push_interval', 60)));
        return max(self::FRESH_SECONDS, intdiv($interval * 11 + 9, 10) + 30);
    }

    /** Old IP_node identifiers and plain addresses share one canonical identity. */
    public static function normalizeIps(array $values): array
    {
        $ips = [];
        foreach ($values as $value) {
            if (!is_string($value)) continue;
            $ip = explode('_', $value, 2)[0];
            if (!filter_var($ip, FILTER_VALIDATE_IP)) continue;
            $packed = inet_pton($ip);
            // Match netip.Addr.Unmap in V2Box: mapped IPv4 is the same address.
            if (strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10)."\xff\xff") $packed = substr($packed, 12);
            $ip = inet_ntop($packed);
            $ips[$ip] = $ip;
        }
        return array_values($ips);
    }

    /** Never trust the stored aggregate: another node may have renewed its TTL. */
    public static function project($cached, ?int $now = null, ?int $mode = null): array
    {
        $now ??= time();
        $window = self::freshWindow();
        $nodes = [];
        $connections = [];
        $unique = [];
        foreach (is_array($cached) ? $cached : [] as $node => $entry) {
            if (!is_string($node) || !is_array($entry) || !is_array($entry['aliveips'] ?? null)) continue;
            $at = $entry['lastupdateAt'] ?? null;
            if (!is_numeric($at) || $at <= $now - $window || $at > $now + 1) continue;
            $ips = self::normalizeIps($entry['aliveips']);
            if (!$ips) continue;
            $nodes[$node] = ['aliveips' => $ips, 'lastupdateAt' => (int) $at];
            foreach ($ips as $ip) {
                $unique[$ip] = true;
                $connections[] = ['ip' => $ip, 'node' => $node, 'online_at' => (int) $at];
            }
        }
        $mode ??= (int) config('v2board.device_limit_mode', 0);
        return ['nodes' => $nodes, 'connections' => $connections,
            'count' => $mode === 1 ? count($unique) : count($connections)];
    }

    public static function forUsers(array $ids, ?int $now = null): array
    {
        $now ??= time();
        $keys = [];
        foreach (array_unique($ids) as $id) $keys[(int) $id] = 'ALIVE_IP_USER_'.(int) $id;
        $cached = $keys ? Cache::many(array_values($keys)) : [];
        $result = [];
        foreach ($keys as $id => $key) $result[$id] = self::project($cached[$key] ?? null, $now);
        return $result;
    }

    public static function forUser(int $id): array
    {
        return self::project(Cache::get('ALIVE_IP_USER_'.$id));
    }

    /** Each report replaces this node's snapshot; other nodes remain independent. */
    public function replace(string $type, int $id, array $reported, int $logInterval): void
    {
        $node = $type.$id;
        $indexKey = 'ALIVE_NODE_USERS:'.$node;
        $ttl = self::freshWindow() + 20;
        $current = [];
        foreach ($reported as $uid => $ips) {
            if (!ctype_digit((string) $uid) || filter_var($uid, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false || !is_array($ips)) continue;
            $current[(int) $uid] = self::normalizeIps($ips);
        }
        try {
            $nodeLock = Cache::lock($indexKey.':lock', self::LOCK_SECONDS);
            $nodeLock->block(5, function () use ($nodeLock, $node, $indexKey, $current, $logInterval, $ttl) {
                $now = time();
                $previous = Cache::get($indexKey, []);
                $affected = array_unique(array_merge(is_array($previous) ? $previous : [], array_keys($current)));
                sort($affected, SORT_NUMERIC);
                // Preserve all touched IDs if a partial failure requires a later cleanup.
                Cache::put($indexKey, $affected, $ttl);
                $lastRefresh = $now;
                $renew = function () use ($nodeLock, $indexKey, $affected, $ttl, &$lastRefresh) {
                    if (time() - $lastRefresh < 30) return;
                    if (!$nodeLock->refresh(self::LOCK_SECONDS)) abort(503, 'Online snapshot lease expired. Please retry.');
                    Cache::put($indexKey, $affected, $ttl);
                    $lastRefresh = time();
                };
                foreach ($affected as $uid) {
                    $renew();
                    if (!is_numeric($uid) || (int) $uid < 1) continue;
                    $uid = (int) $uid;
                    $key = 'ALIVE_IP_USER_'.$uid;
                    Cache::lock($key.':lock', 10)->block(5, function () use ($key, $node, $current, $uid, $now, $nodeLock, $ttl) {
                        if (!$nodeLock->isOwnedByCurrentProcess()) abort(503, 'Online snapshot lease expired. Please retry.');
                        $state = self::project(Cache::get($key));
                        $nodes = $state['nodes'];
                        unset($nodes[$node]);
                        $ips = $current[$uid] ?? [];
                        if ($ips) {
                            $nodes[$node] = ['aliveips' => $ips, 'lastupdateAt' => $now];
                        }
                        if (!$nodes) Cache::forget($key);
                        else {
                            $count = self::project($nodes)['count'];
                            Cache::put($key, $nodes + ['alive_ip' => $count], $ttl);
                        }
                    });
                    $ips = $current[$uid] ?? [];
                    if (!$ips) continue;
                    // SQL and per-IP history never extend the per-user cache critical section.
                    $snapshot = ['ip' => $ips[count($ips) - 1], 'node' => $node, 'online_at' => $now, 'updated_at' => $now];
                    UserOnlineSnapshot::query()->insertOrIgnore($snapshot + ['user_id' => $uid, 'source' => 'alive', 'created_at' => $now]);
                    UserOnlineSnapshot::query()->where('user_id', $uid)->where('source', 'alive')
                        ->where('online_at', '<=', $now)->update($snapshot);
                    foreach ($ips as $ip) {
                        $renew();
                        $throttle = sprintf('USER_CONNECTION_LOG:%d:%s:%s', $uid, md5($ip), $node);
                        if (!Cache::add($throttle, 1, $logInterval)) continue;
                        try {
                            UserConnectionLog::query()->create(['user_id' => $uid, 'ip' => $ip, 'node' => $node, 'source' => 'alive', 'connected_at' => $now]);
                        } catch (\Throwable $error) {
                            Cache::forget($throttle);
                            throw $error;
                        }
                    }
                }
                $renew();
                if (!$nodeLock->isOwnedByCurrentProcess()) abort(503, 'Online snapshot lease expired. Please retry.');
                Cache::put($indexKey, array_keys(array_filter($current)), $ttl);
            });
        } catch (LockTimeoutException $error) {
            abort(503, 'Online snapshot is being refreshed. Please retry.');
        }
    }
}
