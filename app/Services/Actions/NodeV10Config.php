<?php
namespace App\Services\Actions;
class NodeV10Config {
    public const FIELDS = [
        'protocol' => 'protocol',
        'listen_ip' => 'listenAddress',
        'server_port' => 'listenPort',
        'network' => 'network',
        'network_settings' => 'networkSettings',
        'trusted_x_forwarded_for' => 'trustedXForwardedFor',
        'tls' => 'tls',
        'tls_settings' => 'tlsSettings',
        'encryption' => 'encryption',
        'encryption_settings' => 'encryptionSettings',
        'flow' => 'flow',
        'cipher' => 'cipher',
        'congestion_control' => 'congestionControl',
        'zero_rtt_handshake' => 'zeroRttHandshake',
        'up_mbps' => 'upMbps',
        'down_mbps' => 'downMbps',
        'obfs' => 'obfs',
        'obfs_password' => 'obfsPassword',
        'padding_scheme' => 'paddingScheme',
        'server_key' => 'serverKey',
        'ignore_client_bandwidth' => 'ignoreClientBandwidth',
        'base_config' => 'intervals',
        'routes' => 'routes',
        'sing_box' => 'singBox'
    ];
    public const NESTED = [
        'server_name' => 'serverName',
        'server_names' => 'serverNames',
        'server_port' => 'serverPort',
        'short_id' => 'shortId',
        'short_ids' => 'shortIds',
        'private_key' => 'privateKey',
        'cert_mode' => 'certMode',
        'cert_file' => 'certFile',
        'key_file' => 'keyFile',
        'tls_cert' => 'tlsCert',
        'tls_key' => 'tlsKey',
        'provider' => 'provider',
        'dns_env' => 'dnsEnv',
        'reject_unknown_sni' => 'rejectUnknownSni',
        'dest' => 'dest',
        'xver' => 'xver',
        'mldsa65Seed' => 'mldsa65Seed',
        'push_interval' => 'pushInterval',
        'pull_interval' => 'pullInterval',
        'node_report_min_traffic' => 'nodeReportMinTraffic',
        'device_online_min_traffic' => 'deviceOnlineMinTraffic',
        'id' => 'id',
        'match' => 'match',
        'action' => 'action',
        'action_value' => 'actionValue'
    ];
    private static function fields(array $source, array $mapping): array {
        $out = [];
        foreach ($mapping as $old => $new) if (array_key_exists($old, $source)) $out[$new] = $source[$old];
        return $out;
    }
    public static function build($node): array {
        [$node,$transition] = \App\Services\NodeTlsTransition::overlay($node);
        $source = NodeConfiguration::build($node);
        foreach (['tls_settings', 'base_config'] as $key) $source[$key] = (object) self::fields($source[$key] ?? [], self::NESTED);
        if (isset($source['routes']) && $source['routes'] instanceof \Illuminate\Contracts\Support\Arrayable) $source['routes'] = $source['routes']->toArray();
        $source['routes'] = array_map(fn($r) => self::fields($r, self::NESTED), $source['routes'] ?? []);
        foreach (['network_settings', 'encryption_settings'] as $key) {
            if (is_array($source[$key] ?? null)) $source[$key] = (object) $source[$key];
        }
        return self::fields($source, self::FIELDS) + ['trafficBatchDedup'=>true,'trafficBudgetSupported'=>true] + ($transition ? ['domainTransition'=>$transition] : []);
    }
}
