<?php

namespace App\Services;

use App\Models\ServerV2box;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Read-only admin projection for the latest signed node deployment. */
final class NodeDeploymentTask
{
    private const RETENTION = 172800;

    private static function cache()
    {
        return Cache::store('node_deployment');
    }

    public static function issued(int $nodeId, string $taskId, int $expires, string $resumeCommand): array
    {
        $task = ['id' => $taskId, 'expires' => $expires, 'resumeCommand' => $resumeCommand];
        abort_unless(self::cache()->put('task:node:'.$nodeId, $task, self::RETENTION), 503);
        return self::summary($task, 'issued');
    }

    public static function redeemed(string $taskId, ?string $workflowToken): void
    {
        $workflowHash = $workflowToken ? hash('sha256', $workflowToken) : null;
        $workflow = $workflowHash ? self::cache()->get('workflow:'.$workflowHash) : null;
        abort_unless(!$workflowHash || $workflow, 503);
        abort_unless(self::cache()->put('task:grant:'.$taskId, [
            'workflowHash' => $workflowHash,
            'expires' => $workflow['expires'] ?? null,
        ], self::RETENTION), 503);
    }

    public static function rejected(string $taskId): void
    {
        self::cache()->put('task:grant:'.$taskId, ['rejected' => true], self::RETENTION);
    }

    public static function observed(string $token, array $result): void
    {
        $cache = self::cache();
        $hash = hash('sha256', $token);
        if ($result['completed']) {
            $cache->put('task:finished:'.$hash, 'completed', self::RETENTION);
            return;
        }
        $error = null;
        if (($result['applicationState'] ?? null) === 'failed') {
            $workflow = $cache->get('workflow:'.$hash);
            $started = $workflow['startedAt'] ?? null;
            if ($started && DB::table('v2_node_credential')->where('id', $workflow['credential'])
                ->where('last_used_at', '>=', $started)->exists()) {
                $error = $result['errorCode'] ?? 'core';
            }
        }
        $cache->put('task:contact:'.$hash, ['error' => $error], self::RETENTION);
    }

    public static function checkRejection(string $token, int $status): void
    {
        if (!in_array($status, [403, 409], true)) return;
        $hash = hash('sha256', $token);
        $workflow = self::cache()->get('workflow:'.$hash);
        if (!$workflow || $workflow['completed']) return;
        if ($status === 409) {
            $node = ServerV2box::find($workflow['nodeId']);
            // Waiting for DNS or for the application receipt is also a 409.
            if ($node && hash_equals($workflow['proof'], NodeDeploymentWorkflow::snapshot($node))) return;
        }
        self::cache()->put('task:contact:'.$hash, ['rejected' => true], self::RETENTION);
    }

    public static function latest(int $nodeId): ?array
    {
        $cache = self::cache();
        $task = $cache->get('task:node:'.$nodeId);
        if (!$task) return null;
        $enrollment = $cache->get('task:grant:'.$task['id']);
        if (!$enrollment) {
            return self::summary($task, $task['expires'] <= time() ? 'command_expired' : 'issued');
        }
        if (!empty($enrollment['rejected'])) return self::summary($task, 'invalidated');
        $hash = $enrollment['workflowHash'];
        if (!$hash) return self::summary($task, 'legacy');

        $workflow = $cache->get('workflow:'.$hash);
        $phase = $cache->get('task:finished:'.$hash);
        $error = null;
        if (!empty($workflow['completed'])) {
            $phase = 'completed';
        } elseif (!$phase) {
            if ($enrollment['expires'] <= time()) {
                $phase = 'recovery_expired';
            } elseif (!$workflow) {
                $phase = 'invalidated';
            } else {
                $contact = $cache->get('task:contact:'.$hash);
                $error = $contact['error'] ?? null;
                if (!empty($contact['rejected'])) $phase = 'invalidated';
                elseif ($error) $phase = 'failed';
                elseif ($workflow['startedAt']) $phase = 'applying';
                else $phase = $contact ? 'preparing' : 'redeemed';
            }
        }
        return self::summary($task, $phase, $enrollment['expires'], $error);
    }

    private static function summary(array $task, string $phase, ?int $recoveryExpires = null, ?string $error = null): array
    {
        return [
            'id' => $task['id'], 'phase' => $phase, 'errorCode' => $error,
            'resumeCommand' => $task['resumeCommand'],
            'commandExpiresAt' => gmdate('Y-m-d\TH:i:s\Z', $task['expires']),
            'recoveryExpiresAt' => $recoveryExpires ? gmdate('Y-m-d\TH:i:s\Z', $recoveryExpires) : null,
        ];
    }
}
