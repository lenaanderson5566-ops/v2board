<?php
namespace App\Services\Actions;
use App\Services\ServerService;
use App\Utils\Helper;
class NodeConfiguration {
    public static function build($node): array {
        $response = [
            'listen_ip' => $node->listen_ip,
            'server_port' => $node->server_port,
            'network' => $node->network,
            'network_settings' => $node->network_settings,
            'trusted_x_forwarded_for'=> $node->trusted_x_forwarded_for,
            'protocol' => $node->protocol,
            'tls' => $node->tls,
            'tls_settings' => (int)$node->tls===1 ? \App\Services\NodeCertificateCredential::resolve($node->tls_settings?:[]) : $node->tls_settings,
            'encryption' => $node->encryption,
            'encryption_settings' => $node->encryption_settings,
            'flow' => $node->flow,
            'cipher' => $node->cipher,
            'congestion_control' => $node->congestion_control,
            'zero_rtt_handshake' => $node->zero_rtt_handshake ? true : false,
            'up_mbps' => $node->up_mbps,
            'down_mbps' => $node->down_mbps,
            'obfs' => $node->obfs,
            'obfs_password' => $node->obfs_password,
            'padding_scheme' => $node->padding_scheme
        ];

        if ($node->cipher === '2022-blake3-aes-128-gcm') {
            $response['server_key'] = Helper::getServerKey($node->created_at, 16);
        }

        if ($node->cipher === '2022-blake3-aes-256-gcm') {
            $response['server_key'] = Helper::getServerKey($node->created_at, 32);
        }

        if ($node->up_mbps == 0 && $node->down_mbps == 0) {
            $response['ignore_client_bandwidth'] = true;
        } else {
            $response['ignore_client_bandwidth'] = false;
        }

        $response['base_config'] = [
            'push_interval' => (int)config('v2board.server_push_interval', 60),
            'pull_interval' => (int)config('v2board.server_pull_interval', 60),
            'node_report_min_traffic' => (int)config('v2board.server_node_report_min_traffic', 0),
            'device_online_min_traffic' => (int)config('v2board.server_device_online_min_traffic', 0)
        ];

        if ($node['route_id']) {
            $response['routes'] = (new ServerService())->getRoutes($node['route_id'], 'v2box');
        }

        return $response;
    }
}
