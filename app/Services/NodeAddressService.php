<?php
namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class NodeAddressService
{
    public static function observe(Request $request, string $type, int $id): void
    {
        $ip = $request->ip();
        if (is_string($ip) && NodeDdnsService::publicAddress($ip, str_contains($ip, ':') ? 6 : 4)) {
            Cache::put('NODE_CURRENT_IP:'.$type.':'.$id, inet_ntop(inet_pton($ip)), 86400);
        }
    }

    public static function forNodes(array $nodes): array
    {
        $reports = DB::table('v2_node_ddns')->where('enabled', 1)->get()->keyBy(fn ($r) => $r->node_type.':'.$r->node_id);
        foreach ($nodes as &$node) {
            $id = ($node['parent_id'] ?? null) ?: $node['id'];
            $key = $node['type'].':'.$id;
            $report = $reports->get($key);
            $ips = [];
            foreach (['ipv4', 'ipv6'] as $family) {
                if ($report && $report->{$family} && $report->{$family.'_seen_at'} >= time() - 900) {
                    $ips[] = $report->{$family};
                }
            }
            $node['current_ip'] = $ips ? implode(' / ', $ips) : Cache::get('NODE_CURRENT_IP:'.$key);
        }
        return $nodes;
    }
}
