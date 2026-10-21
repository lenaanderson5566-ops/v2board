<?php
namespace App\Services;

use Illuminate\Cache\RedisStore;
use Illuminate\Support\Facades\Cache;

/** Dedicated expiring Redis namespace. No SQL, file cache or queue on ingest. */
final class TargetStatisticsStore
{
    public const BUDGET_BYTES = 64 * 1024 * 1024;
    public const MAX_CONTAINERS = 4096;
    public const MAX_REQUEST_BYTES = 262144;

    public function budgetBytes(): int { return max(8, min(1024, (int)config('cache.target_statistics_budget_mb', 64))) * 1024 * 1024; }

    public function repository() { return Cache::store('target_statistics'); }
    private function store(): RedisStore { return $this->repository()->getStore(); }
    public function connection() { return $this->store()->connection(); }
    public function prefix(): string { return $this->store()->getPrefix().'{target-statistics-v2}:'; }

    public function policy(): ?array
    {
        $value = $this->connection()->get($this->prefix().'policy');
        return is_string($value) ? json_decode($value, true) : null;
    }

    public function publishPolicy(array $policy): void
    {
        $this->connection()->setex($this->prefix().'policy', 300, json_encode($policy, JSON_THROW_ON_ERROR));
    }

    /** Atomic policy gate, hourly deduplication, bounded admission and counters. */
    public function ingest(int $node, string $version, string $batch, string $hash, array $rows, int $dropped, int $bytes, ?int $now = null): array
    {
        $now ??= time();
        $bucket = intdiv($now, 300) * 300;
        $prefix = $this->prefix();
        $keys = [$prefix.'policy', $prefix.$node.':'.$bucket, $prefix.$node.':batches', $prefix.$node.':batch-times',
            $prefix.'sizes', $prefix.'expiry', $prefix.'metrics', $prefix.'used'];
        $result = $this->connection()->eval(self::MERGE, count($keys), ...array_merge($keys, [
            $version, $batch, $hash, json_encode($rows, JSON_THROW_ON_ERROR), $dropped, $now,
            $bucket + 3600, $this->budgetBytes(), self::MAX_CONTAINERS, $bytes,
        ]));
        $code = (int)$result;
        abort_if($code === -1, 409, 'Batch content changed');
        abort_if($code === -2, 429, 'Statistics batch capacity reached');
        abort_if($code === -3, 429, 'Statistics cache budget reached');
        return ['accepted' => $code > 0];
    }

    public function report(int $node, string $version): array
    {
        $prefix = $this->prefix();
        $bucket = intdiv(time(), 300) * 300;
        $values = $this->connection()->pipeline(function ($pipe) use ($prefix, $node, $bucket) {
            for ($i = 0; $i < 12; $i++) $pipe->hgetall($prefix.$node.':'.($bucket - $i * 300));
        });
        $rows = []; $dropped = 0;
        foreach ($values as $value) {
            if (($value['_version'] ?? null) !== $version) continue;
            $dropped += (int)($value['_dropped'] ?? 0);
            foreach ($value as $field => $metadata) {
                if (!str_starts_with($field, 'm:')) continue;
                $key = substr($field, 2);
                if (!isset($rows[$key])) $rows[$key] = json_decode($metadata, true) + ['connections'=>0, 'uploadBytes'=>0, 'downloadBytes'=>0];
                foreach (['connections'=>'c:', 'uploadBytes'=>'u:', 'downloadBytes'=>'d:'] as $name=>$counter) {
                    $rows[$key][$name] += (int)($value[$counter.$key] ?? 0);
                }
            }
        }
        return ['rows'=>array_values($rows), 'dropped'=>$dropped];
    }

    public function usage(): array
    {
        $prefix = $this->prefix();
        $values = $this->connection()->pipeline(function ($pipe) use ($prefix) {
            $pipe->get($prefix.'used');
            $pipe->hgetall($prefix.'metrics');
        });
        return ['budgetBytes'=>$this->budgetBytes(), 'usedBytes'=>(int)($values[0] ?: 0),
            'rejectedBatches'=>(int)($values[1]['rejected'] ?? 0), 'receivedBytes'=>(int)($values[1]['receivedBytes'] ?? 0),
            'acceptedBatches'=>(int)($values[1]['accepted'] ?? 0), 'duplicateBatches'=>(int)($values[1]['duplicates'] ?? 0),
            'maxRequestBytes'=>self::MAX_REQUEST_BYTES];
    }

    private const MERGE = <<<'LUA'
local policy = redis.call('GET', KEYS[1])
if not policy then return 0 end
policy = cjson.decode(policy)
if not policy.enabled or policy.version ~= ARGV[1] then return 0 end
local now = tonumber(ARGV[6])
local function metric(name, n)
    redis.call('HINCRBY', KEYS[7], name, n)
    redis.call('EXPIRE', KEYS[7], 3600)
end
-- Expired payloads are physically reclaimed by Redis. Prune bounded ledger work.
local used = tonumber(redis.call('GET', KEYS[8]) or '0')
for _, key in ipairs(redis.call('ZRANGEBYSCORE', KEYS[6], '-inf', now, 'LIMIT', 0, 512)) do
    used = used - tonumber(redis.call('HGET', KEYS[5], key) or '0')
    redis.call('HDEL', KEYS[5], key)
    redis.call('ZREM', KEYS[6], key)
end
used = math.max(0, used)
redis.call('SET', KEYS[8], used, 'EX', 7200)
for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now - 3600)) do
    redis.call('HDEL', KEYS[3], id)
    redis.call('ZREM', KEYS[4], id)
end
local previous = redis.call('HGET', KEYS[3], ARGV[2])
if previous then
    if previous ~= ARGV[3] then return -1 end
    metric('duplicates', 1)
    return 2
end
local batches = redis.call('HLEN', KEYS[3])
if batches >= 1000 then metric('rejected', 1); return -2 end
local same = redis.call('HGET', KEYS[2], '_version') == ARGV[1]
local rowCount = same and tonumber(redis.call('HGET', KEYS[2], '_rows') or '0') or 0
local bucketCost = same and tonumber(redis.call('HGET', KEYS[2], '_cost') or '1024') or 1024
local selected = {}; local new = {}; local dropped = tonumber(ARGV[5])
for _, row in ipairs(cjson.decode(ARGV[4])) do
    local exists = same and redis.call('HEXISTS', KEYS[2], 'm:'..row.key) == 1
    if exists or new[row.key] then
        table.insert(selected, row)
    elseif rowCount < 500 then
        new[row.key] = true; rowCount = rowCount + 1
        -- Estimated logical cost includes field names, values and Redis object overhead; not allocator RSS.
        bucketCost = bucketCost + string.len(row.meta) + 1024
        table.insert(selected, row)
    else dropped = dropped + 1 end
end
local oldBucket = tonumber(redis.call('HGET', KEYS[5], KEYS[2]) or '0')
local oldBatches = tonumber(redis.call('HGET', KEYS[5], KEYS[3]) or '0')
local batchCost = (batches + 1) * 512 + 1024
local nextUsed = used - oldBucket - oldBatches + bucketCost + batchCost
local containers = redis.call('HLEN', KEYS[5])
if oldBucket == 0 then containers = containers + 1 end
if oldBatches == 0 then containers = containers + 1 end
if nextUsed > tonumber(ARGV[8]) or containers > tonumber(ARGV[9]) then
    metric('rejected', 1); return -3
end
if not same then redis.call('DEL', KEYS[2]) end
redis.call('HSET', KEYS[2], '_version', ARGV[1], '_rows', rowCount, '_cost', bucketCost)
for _, row in ipairs(selected) do
    redis.call('HSET', KEYS[2], 'm:'..row.key, row.meta)
    -- HINCRBY keeps 64-bit counts exact; Lua doubles never accumulate traffic.
    redis.call('HINCRBY', KEYS[2], 'c:'..row.key, string.format('%.0f', row.connections))
    redis.call('HINCRBY', KEYS[2], 'u:'..row.key, string.format('%.0f', row.uploadBytes))
    redis.call('HINCRBY', KEYS[2], 'd:'..row.key, string.format('%.0f', row.downloadBytes))
end
redis.call('HINCRBY', KEYS[2], '_dropped', string.format('%.0f', dropped))
redis.call('EXPIREAT', KEYS[2], ARGV[7])
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('ZADD', KEYS[4], now, ARGV[2])
redis.call('EXPIRE', KEYS[3], 3600); redis.call('EXPIRE', KEYS[4], 3600)
redis.call('HSET', KEYS[5], KEYS[2], bucketCost, KEYS[3], batchCost)
redis.call('ZADD', KEYS[6], ARGV[7], KEYS[2], now + 3600, KEYS[3])
redis.call('EXPIRE', KEYS[5], 7200); redis.call('EXPIRE', KEYS[6], 7200)
redis.call('SET', KEYS[8], nextUsed, 'EX', 7200)
metric('accepted', 1); metric('receivedBytes', tonumber(ARGV[10]))
return 1
LUA;
}
