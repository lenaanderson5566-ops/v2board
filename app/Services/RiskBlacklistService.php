<?php

namespace App\Services;

use App\Models\RiskBlacklistIp;
use App\Models\RiskBlacklistUaHash;

class RiskBlacklistService
{
    public function fetch()
    {
        $rows = [];

        foreach (RiskBlacklistIp::query()->orderBy('id', 'desc')->get() as $row) {
            $rows[] = [
                'id' => 'ip:' . $row->id,
                'type' => 'ip',
                'value' => $row->value,
                'ua_raw' => null,
                'remark' => $row->remark,
                'is_enabled' => (bool) $row->is_enabled,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ];
        }

        foreach (RiskBlacklistUaHash::query()->orderBy('id', 'desc')->get() as $row) {
            $rows[] = [
                'id' => 'ua_hash:' . $row->id,
                'type' => 'ua_hash',
                'value' => $row->value,
                'ua_raw' => $row->ua_raw,
                'remark' => $row->remark,
                'is_enabled' => (bool) $row->is_enabled,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ];
        }

        usort($rows, function ($a, $b) {
            $aId = (int) substr((string) $a['id'], strpos((string) $a['id'], ':') + 1);
            $bId = (int) substr((string) $b['id'], strpos((string) $b['id'], ':') + 1);

            return [$a['type'], -$aId] <=> [$b['type'], -$bId];
        });

        return $rows;
    }

    public function save(array $items)
    {
        foreach ($items as $item) {
            $type = strtolower((string) ($item['type'] ?? ''));
            $value = $this->normalizeValue($type, (string) ($item['value'] ?? ''), $item);
            if (!$type || !$value || !in_array($type, ['ip', 'ua_hash'])) {
                abort(422, 'invalid blacklist item');
            }

            $payload = [
                'remark' => array_key_exists('remark', $item) ? trim((string) ($item['remark'] ?? '')) : null,
                'is_enabled' => array_key_exists('is_enabled', $item) ? (int) ((bool) $item['is_enabled']) : 1,
            ];

            if ($type === 'ip') {
                RiskBlacklistIp::query()->updateOrCreate(['value' => $value], $payload);
            } else {
                $payload['ua_raw'] = array_key_exists('ua_raw', $item) ? trim((string) ($item['ua_raw'] ?? '')) : null;
                RiskBlacklistUaHash::query()->updateOrCreate(['value' => $value], $payload);
            }
        }

        return $this->fetch();
    }

    public function delete(string $id)
    {
        $id = trim($id);
        if (strpos($id, 'ip:') === 0) {
            $rid = (int) substr($id, 3);
            if ($rid > 0) RiskBlacklistIp::query()->where('id', $rid)->delete();
        } elseif (strpos($id, 'ua_hash:') === 0) {
            $rid = (int) substr($id, 8);
            if ($rid > 0) RiskBlacklistUaHash::query()->where('id', $rid)->delete();
        } else {
            abort(422, 'invalid id');
        }

        return $this->fetch();
    }

    public function exists(string $type, ?string $value): bool
    {
        $type = strtolower(trim($type));
        $value = $this->normalizeValue($type, (string) $value, []);
        if (!$type || !$value) {
            return false;
        }

        if ($type === 'ip') {
            return RiskBlacklistIp::query()->where('value', $value)->where('is_enabled', 1)->exists();
        }
        if ($type === 'ua_hash') {
            return RiskBlacklistUaHash::query()->where('value', $value)->where('is_enabled', 1)->exists();
        }

        return false;
    }

    private function normalizeValue(string $type, string $value, array $item = []): ?string
    {
        $value = trim($value);
        if ($type === 'ua_hash') {
            $uaRaw = trim((string) ($item['ua_raw'] ?? ''));
            if (!$value && $uaRaw) {
                return hash('sha256', $uaRaw);
            }
            if ($value && !preg_match('/^[a-f0-9]{64}$/', strtolower($value))) {
                if ($uaRaw) {
                    return hash('sha256', $uaRaw);
                }
                return null;
            }
            return strtolower($value);
        }

        if (!$value) {
            return null;
        }

        if (filter_var($value, FILTER_VALIDATE_IP) === false) {
            return null;
        }

        return $value;
    }
}
