<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use App\Services\Actions\NodeConfiguration;
use App\Services\Actions\NodeV10Config;

class NodeRuntimeService
{
    public static function record(string $type, int $id, array $configuration, string $contract): void
    {
        Cache::put(\App\Utils\CacheKey::get('SERVER_' . strtoupper($type) . '_LAST_CHECK_AT', $id), time(), 3600);
        Cache::put("NODE_CONFIG_FETCH:{$type}:{$id}", [
            'hash' => hash('sha256', json_encode($configuration)),
            'providedAt' => time(), 'contract' => $contract,
        ], 86400);
    }

    public static function connection(?int $checked, ?int $pushed, bool $blocked): string
    {
        if (!$checked && !$pushed) return 'unknown';
        if (max($checked ?? 0, $pushed ?? 0) < time() - 300) return 'offline';
        return $blocked ? 'limited' : 'online';
    }

    public static function inspect(string $type, $node): array
    {
        $id = (int) ($node->parent_id ?: $node->id);
        $root = $node->parent_id ? (new ServerService())->getServer($id, $type) : $node;
        abort_unless($root, 404, '父节点不存在');
        $last = Cache::get("NODE_CONFIG_FETCH:{$type}:{$id}");
        $capabilities = $type === 'v2box' ? Cache::get("V2BOX_CAPABILITIES:{$id}") : null;
        $state = 'unknown';
        if ($last) {
            try {
                $configuration = $last['contract'] === 'v10' ? NodeV10Config::build($root) : NodeConfiguration::build($root);
                $state = hash_equals($last['hash'], hash('sha256', json_encode($configuration))) ? 'provided' : 'pending';
            } catch (\Throwable $e) { $state = 'invalid'; }
        }
        return ['configurationState' => $state, 'providedAt' => $last['providedAt'] ?? null,
            'applicationState' => 'unconfirmed', 'inheritedFrom' => $node->parent_id ? $id : null,
            'coreVersion' => $capabilities['coreVersion'] ?? null,
            'capabilitiesReportedAt' => $capabilities['reportedAt'] ?? null];
    }
}
