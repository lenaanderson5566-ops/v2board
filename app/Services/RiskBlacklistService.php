<?php

namespace App\Services;

use App\Models\RiskBlacklistIp;
use App\Models\RiskBlacklistUaHash;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

class RiskBlacklistService
{
    private const MODELS = ['ip' => RiskBlacklistIp::class, 'ua_hash' => RiskBlacklistUaHash::class];

    public function fetch(?string $type = null): array
    {
        $rows = [];
        foreach (self::MODELS as $itemType => $model) {
            if ($type !== null && $type !== $itemType) continue;
            foreach ($model::query()->orderByDesc('id')->get() as $row) {
                $rows[] = [
                    'id' => $itemType.':'.$row->id,
                    'type' => $itemType,
                    'value' => $row->value,
                    'ua_raw' => $itemType === 'ua_hash' ? $row->ua_raw : null,
                    'remark' => $row->remark,
                    'is_enabled' => $row->is_enabled,
                    'expires_at' => $row->expires_at,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }
        }
        return $rows;
    }

    public function save(array $items): array
    {
        try {
            DB::transaction(function () use ($items) {
                foreach ($items as $item) {
                    $type = strtolower((string)($item['type'] ?? ''));
                    $model = self::MODELS[$type] ?? null;
                    abort_unless($model, 422, '无效的黑名单类型');
                    $row = isset($item['id'])
                        ? $model::query()->lockForUpdate()->findOrFail($this->recordId($type, $item['id']))
                        : null;
                    $payload = array_intersect_key($item, array_flip(['remark', 'is_enabled', 'expires_at']));
                    if (isset($payload['remark'])) $payload['remark'] = trim($payload['remark']);
                    if ($type === 'ip') {
                        $value = $this->normalizeIp(trim($item['value'] ?? ''));
                        abort_unless($value, 422, '请输入有效的 IP 地址或 CIDR 网段');
                    } else {
                        [$value, $raw] = $this->normalizeUa($item, $row);
                        if ($raw !== null || array_key_exists('ua_raw', $item) || ($row && $value !== $row->value)) {
                            $payload['ua_raw'] = $raw;
                        }
                    }
                    if ($row) {
                        $row->update(['value' => $value] + $payload);
                    } else {
                        $model::query()->updateOrCreate(['value' => $value], $payload);
                    }
                }
            }, 3);
        } catch (UniqueConstraintViolationException $exception) {
            abort(409, '黑名单中已存在该值，请编辑已有条目');
        }
        return $this->fetch();
    }

    public function delete(string $id): array
    {
        $type = explode(':', $id, 2)[0];
        $model = self::MODELS[$type] ?? null;
        abort_unless($model, 422, '无效的黑名单 ID');
        $model::query()->whereKey($this->recordId($type, $id))->delete();
        return $this->fetch();
    }

    public function exists(string $type, ?string $value): bool
    {
        $type = strtolower(trim($type));
        $model = self::MODELS[$type] ?? null;
        $value = trim((string)$value);
        if (!$model || $value === '') return false;

        if ($type === 'ip') {
            if (!filter_var($value, FILTER_VALIDATE_IP)) return false;
            $packed = inet_pton($value);
            $matches = [$value, inet_ntop($packed)];
            // Enumerate the address's containing networks so the unique value index
            // can be used for both exact addresses and CIDRs.
            for ($prefix = 0, $bits = strlen($packed) * 8; $prefix <= $bits; $prefix++) {
                $matches[] = $this->networkValue($packed, $prefix);
            }
        } else {
            $matches = [preg_match('/^[a-f0-9]{64}$/iD', $value) ? strtolower($value) : hash('sha256', $value)];
        }

        return $model::query()->whereIn('value', $matches)->where('is_enabled', true)
            ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', time()))
            ->exists();
    }

    private function recordId(string $type, string $id): int
    {
        [$prefix, $raw] = array_pad(explode(':', $id, 2), 2, '');
        $number = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        abort_unless($prefix === $type && $number !== false && (string)$number === $raw, 422, '无效的黑名单 ID');
        return $number;
    }

    private function normalizeIp(string $value): ?string
    {
        [$ip, $prefix] = array_pad(explode('/', $value, 2), 2, null);
        if (!filter_var($ip, FILTER_VALIDATE_IP)) return null;
        $packed = inet_pton($ip);
        if ($prefix === null) return inet_ntop($packed);
        if (!preg_match('/^\d{1,3}$/D', $prefix) || (int)$prefix > strlen($packed) * 8) return null;
        return $this->networkValue($packed, (int)$prefix);
    }

    private function networkValue(string $packed, int $prefix): string
    {
        $bytes = intdiv($prefix, 8);
        $remainder = $prefix % 8;
        $network = substr($packed, 0, $bytes);
        if ($remainder) $network .= chr(ord($packed[$bytes]) & (0xff << (8 - $remainder)));
        return inet_ntop(str_pad($network, strlen($packed), "\0")).'/'.$prefix;
    }

    private function normalizeUa(array $item, ?Model $row): array
    {
        $value = trim($item['value'] ?? '');
        $raw = trim($item['ua_raw'] ?? '');
        $isHash = preg_match('/^[a-f0-9]{64}$/iD', $value);
        if ($raw !== '' && $isHash && hash('sha256', $raw) !== strtolower($value)) {
            // An editor may send both fields even when only one was changed.
            if ($row && $raw === $row->ua_raw && strtolower($value) !== $row->value) {
                $raw = '';
            } elseif (!$row || strtolower($value) !== $row->value) {
                abort(422, '原始 UA 与填写的哈希不匹配');
            }
        }
        if ($raw !== '') return [hash('sha256', $raw), $raw];
        abort_if($value === '', 422, '请输入原始 UA 或哈希');
        return $isHash ? [strtolower($value), null] : [hash('sha256', $value), $value];
    }
}
