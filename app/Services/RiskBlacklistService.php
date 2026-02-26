<?php

namespace App\Services;

use App\Models\RiskBlacklist;

class RiskBlacklistService
{
    public function fetch()
    {
        return RiskBlacklist::query()->orderBy('type')->orderBy('id', 'desc')->get();
    }

    public function save(array $items)
    {
        foreach ($items as $item) {
            $type = strtolower((string) ($item['type'] ?? ''));
            $value = $this->normalizeValue($type, (string) ($item['value'] ?? ''));
            if (!$type || !$value || !in_array($type, ['ip', 'ua_hash'])) {
                abort(422, 'invalid blacklist item');
            }

            RiskBlacklist::query()->updateOrCreate(
                ['type' => $type, 'value' => $value],
                [
                    'remark' => array_key_exists('remark', $item) ? trim((string) ($item['remark'] ?? '')) : null,
                    'is_enabled' => array_key_exists('is_enabled', $item) ? (int) ((bool) $item['is_enabled']) : 1,
                ]
            );
        }

        return $this->fetch();
    }

    public function delete(int $id)
    {
        RiskBlacklist::query()->where('id', $id)->delete();
        return $this->fetch();
    }

    public function exists(string $type, ?string $value): bool
    {
        $type = strtolower(trim($type));
        $value = $this->normalizeValue($type, (string) $value);
        if (!$type || !$value) {
            return false;
        }

        return RiskBlacklist::query()
            ->where('type', $type)
            ->where('value', $value)
            ->where('is_enabled', 1)
            ->exists();
    }

    private function normalizeValue(string $type, string $value): ?string
    {
        $value = trim($value);
        if (!$value) {
            return null;
        }

        if ($type === 'ua_hash') {
            $value = strtolower($value);
            if (!preg_match('/^[a-f0-9]{64}$/', $value)) {
                return null;
            }
            return $value;
        }

        return $value;
    }
}
