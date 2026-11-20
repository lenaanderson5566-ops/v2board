<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Services\RiskBlacklistService;
use Illuminate\Http\Request;

class BlacklistController extends Controller
{
    public function getIpBlacklists(Request $request)
    {
        return response([
            'data' => $this->fetchBlacklistsByType('ip')
        ]);
    }

    public function getUaBlacklists(Request $request)
    {
        return response([
            'data' => $this->fetchBlacklistsByType('ua_hash')
        ]);
    }

    public function updateIpBlacklist(Request $request)
    {
        return $this->handleBlacklistUpdate($request, 'ip');
    }

    public function updateUaBlacklist(Request $request)
    {
        return $this->handleBlacklistUpdate($request, 'ua_hash');
    }

    public function deleteIpBlacklist(Request $request)
    {
        return $this->handleBlacklistDelete($request, 'ip:');
    }

    public function deleteUaBlacklist(Request $request)
    {
        return $this->handleBlacklistDelete($request, 'ua_hash:');
    }

    private function fetchBlacklistsByType(string $type)
    {
        $rows = (new RiskBlacklistService())->fetch($type);
        return collect($rows)->values();
    }

    private function handleBlacklistUpdate(Request $request, string $forceType)
    {
        $rawItems = $request->input('items');
        if (is_null($rawItems)) {
            $rawItems = [$request->all()];
        }
        if (!is_array($rawItems)) {
            abort(422, 'items must be an array');
        }

        $items = [];
        foreach ($rawItems as $item) {
            if (!is_array($item)) {
                abort(422, 'each item must be an object');
            }
            if (!array_key_exists('remark', $item) && array_key_exists('reason', $item)) {
                $item['remark'] = $item['reason'];
            }
            if (!array_key_exists('expires_at', $item) && array_key_exists('expired_at', $item)) {
                $item['expires_at'] = $item['expired_at'];
            }
            validator($item, [
                'id' => 'nullable|string|max:32',
                'value' => 'nullable|string|max:4096',
                'remark' => 'nullable|string|max:255',
                'ua_raw' => 'nullable|string|max:4096',
                'expires_at' => 'nullable|integer|min:1|max:253402300799',
            ])->validate();
            $item['type'] = $forceType;
            $item['value'] ??= '';
            if ($item['type'] === 'ua_hash' && empty(trim((string) $item['value'])) && empty(trim((string) ($item['ua_raw'] ?? '')))) {
                abort(422, 'ua_raw is required when value is empty');
            }
            if ($item['type'] === 'ip' && empty(trim((string) $item['value']))) {
                abort(422, 'value is required');
            }
            if (array_key_exists('is_enabled', $item)) {
                $enabled = filter_var($item['is_enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if (is_null($enabled)) {
                    abort(422, 'is_enabled must be boolean');
                }
                $item['is_enabled'] = $enabled;
            }
            $items[] = $item;
        }

        return response([
            'data' => (new RiskBlacklistService())->save($items)
        ]);
    }

    private function handleBlacklistDelete(Request $request, string $prefix)
    {
        $id = $request->validate(['id' => 'required|string|max:32'])['id'];
        if (strpos($id, $prefix) !== 0) {
            abort(422, "id must be {$prefix}*");
        }

        return response([
            'data' => (new RiskBlacklistService())->delete($id)
        ]);
    }
}
