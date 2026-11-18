<?php

namespace App\Services;

use App\Models\ServerV2box;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Review of the default relay endpoint currently delivered to subscribers. */
final class NodeRelayCutover
{
    public static function required($binding, $entry, $affected): bool
    {
        if (!$binding->entry_id || !$affected->contains(fn($line) => (bool)$line->show)) return false;
        if ($affected->contains(fn($line) => $line->host !== $entry->domain || (string)$line->port !== (string)$binding->entry_port)
            || ($binding->published_origin && $binding->published_origin !== $binding->domain)) return true;
        if ($binding->tls_transition_state !== 'pending') return false;
        $candidate = NodeTlsTransition::pending(DB::table('v2_node_ddns')->find($binding->id));
        return !empty($candidate['identityOnly']);
    }

    /** The client test concerns this exact forwarding configuration and applied certificate. */
    public static function review($binding, $entry, $node, $affected, ?array $transition, array $receipt): array
    {
        $runtime = NodeRuntimeService::inspect('v2box', ServerV2box::findOrFail($node->id));
        $tls = $transition['tls'] ?? (json_decode($node->tls_settings ?? '{}', true) ?: []);
        $fingerprint = (int)$node->tls === 1 ? ($receipt['certificateFingerprint'] ?? null) : null;
        $route = fn($row) => [$row->id, $row->credential_id, $row->server_id, $row->domain, $row->family,
            $row->enabled, NetworkServer::addresses($row)];
        $proof = hash('sha256', json_encode([$route($binding), $route($entry), $binding->entry_port,
            $binding->published_domain, $binding->published_port, $binding->published_origin,
            $affected->values(), $transition['id'] ?? null, $receipt['hash'] ?? null, $fingerprint]));
        $ready = $runtime['runtimeStatus'] === 'online' && !$runtime['maintenance']
            && $runtime['applicationState'] === 'applied' && ($receipt['state'] ?? null) === 'applied'
            && ((int)$node->tls !== 1 || preg_match('/^[a-f0-9]{64}$/D', $fingerprint ?? ''))
            && ($binding->tls_transition_state !== 'pending' || ($transition
                && ($receipt['transitionId'] ?? null) === ($transition['configurationOnly'] ? null : $transition['id'])))
            && NetworkServer::ready($binding) && NetworkServer::ready($entry);
        return ['host' => $entry->domain, 'port' => (int)$binding->entry_port,
            'previousHost' => $node->host, 'previousPort' => (string)$node->port,
            'protocol' => $node->protocol, 'serverName' => $tls['server_name'] ?? null,
            'certificateFingerprint' => $fingerprint, 'ready' => $ready, 'proof' => $proof];
    }

    public static function reviews($assignments, $connections): array
    {
        $bindings = $assignments->filter(fn($a) => $a->node_type === 'v2box' && $a->managed && $a->enabled && $a->entry_id);
        if ($bindings->isEmpty()) return [];
        $ids = $bindings->pluck('node_id');
        $lines = DB::table('v2_server_v2box')->where(fn($q) => $q->whereIn('id', $ids)->orWhereIn('service_id', $ids))
            ->orderBy('id')->get(['id','service_id','show','host','port']);
        $roots = $lines->keyBy('id');
        $managed = $connections->where('node_type','v2box')->keyBy('node_id');
        $byService = $lines->reject(fn($line) => $managed->has($line->id))->groupBy(fn($line) => $line->service_id ?: $line->id);
        $byId = $assignments->keyBy('id');
        $reviews = [];
        foreach ($bindings as $binding) {
            $entry = $byId->get($binding->entry_id);
            $node = $roots->get($binding->node_id);
            if (!$entry || !$node || !$entry->enabled) continue;
            $affected = $byService->get($node->id, collect())->filter(fn($line) => strcasecmp($line->host,$node->host) === 0);
            if (self::required($binding, $entry, $affected)) {
                // Load full configuration only when a published endpoint actually needs testing.
                $affected = NodeTlsTransition::affected($binding);
                $node = $affected->firstWhere('id',$binding->node_id);
                if (!$node || !self::required($binding,$entry,$affected)) continue;
                $transition = $binding->tls_transition_state === 'pending'
                    ? NodeTlsTransition::pending(DB::table('v2_node_ddns')->find($binding->id)) : null;
                $receipt = Cache::get('NODE_CONFIG_RECEIPT:v2box:'.$node->id, []);
                $reviews[$binding->id] = self::review($binding, $entry, $node, $affected, $transition, $receipt);
            }
        }
        return $reviews;
    }

    /** An old ingress stays reserved while a different entry or port is being prepared. */
    public static function publishedPort(int $server, int $port, int $exceptBinding = 0): bool
    {
        return DB::table('v2_node_ddns as binding')
            ->join('v2_node_ddns as entry', 'entry.domain', '=', 'binding.published_domain')
            ->where('entry.purpose', 'entry')->where('entry.server_id', $server)
            ->whereNotNull('binding.published_origin')->where('binding.published_port', $port)
            ->where('binding.id', '!=', $exceptBinding)->exists();
    }
}
