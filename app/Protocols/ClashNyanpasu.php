<?php
namespace App\Protocols;

// Preserve the historical Nyanpasu field differences while sharing the renderer.
class ClashNyanpasu extends ClashMeta
{
    public static function buildVmess($uuid, $server)
    {
        $array = [];
        $array['name'] = $server['name'];
        $array['type'] = 'vmess';
        $array['server'] = $server['host'];
        $array['port'] = $server['port'];
        $array['uuid'] = $uuid;
        $array['alterId'] = 0;
        $array['cipher'] = 'auto';
        $array['udp'] = true;

        if (!empty($server['tls'])) {
            $array['tls'] = true;
            $tlsSettings = $server['tlsSettings'] ?? ($server['tls_settings'] ?? null);
            if ($tlsSettings) {
                if (isset($tlsSettings['allowInsecure']) && !empty($tlsSettings['allowInsecure']))
                    $array['skip-cert-verify'] = ($tlsSettings['allowInsecure'] ? true : false);
                if (isset($tlsSettings['serverName']) && !empty($tlsSettings['serverName']))
                    $array['servername'] = $tlsSettings['serverName'];
                if (!empty($tlsSettings['ech'])) {
                    if ($tlsSettings['ech'] === 'cloudflare') {
                        $array['ech-opts'] = [
                            'enable' => true,
                            'query-server-name' => 'cloudflare-ech.com'
                        ];
                    } elseif ($tlsSettings['ech'] === 'custom' && !empty($tlsSettings['ech_config'])) {
                        $array['ech-opts'] = [
                            'enable' => true,
                            'config' => is_array($tlsSettings['ech_config']) ? $tlsSettings['ech_config'] : [$tlsSettings['ech_config']]
                        ];
                    }
                }
            }
        }
        $network = $server['network'] ?? null;
        if ($network === 'tcp') {
            $tcpSettings = $server['networkSettings'] ?? ($server['network_settings'] ?? []);
            if (isset($tcpSettings['header']['type']) && $tcpSettings['header']['type'] == 'http') {
                $array['network'] = $tcpSettings['header']['type'];
                if (isset($tcpSettings['header']['request']['headers']['Host'])) $array['http-opts']['headers']['Host'] = $tcpSettings['header']['request']['headers']['Host'];
                if (isset($tcpSettings['header']['request']['path'])) $array['http-opts']['path'] = $tcpSettings['header']['request']['path'];
            }
        }
        if ($network === 'ws') {
            $array['network'] = 'ws';
            $wsSettings = $server['networkSettings'] ?? ($server['network_settings'] ?? null);
            if ($wsSettings) {
                $array['ws-opts'] = [];
                if (isset($wsSettings['path']) && !empty($wsSettings['path']))
                    $array['ws-opts']['path'] = $wsSettings['path'];
                if (isset($wsSettings['headers']['Host']) && !empty($wsSettings['headers']['Host']))
                    $array['ws-opts']['headers'] = ['Host' => $wsSettings['headers']['Host']];
                if (isset($wsSettings['security'])) 
                    $array['cipher'] = $wsSettings['security'];
            }
        }
        if ($network === 'grpc') {
            $array['network'] = 'grpc';
            $grpcSettings = $server['networkSettings'] ?? ($server['network_settings'] ?? null);
            if ($grpcSettings) {
                $array['grpc-opts'] = [];
                if (isset($grpcSettings['serviceName'])) $array['grpc-opts']['grpc-service-name'] = $grpcSettings['serviceName'];
            }
        }

        if (isset($server['encryption']) && !empty($server['encryption']) && isset($server['encryption_settings']) && !empty($server['encryption_settings'])) {
            $encryptionSettings = $server['encryption_settings'];
            $array['encryption'] = $server['encryption'] ?? 'mlkem768x25519plus';
            $array['encryption'] .= '.' . $encryptionSettings['mode'] ?? 'native';
            $array['encryption'] .= '.' . $encryptionSettings['rtt'] ?? '1rtt';
            if (isset($encryptionSettings['client_padding']) && !empty($encryptionSettings['client_padding'])) {
                $array['encryption'] .= '.' . $encryptionSettings['client_padding'];
            }
            $array['encryption'] .= '.' . $encryptionSettings['password'] ?? '';
        }

        return $array;
    }

    public static function buildVless($uuid, $server)
    {
        $array = [];
        $array['name'] = $server['name'];
        $array['type'] = 'vless';
        $array['server'] = $server['host'];
        $array['port'] = $server['port'];
        $array['uuid'] = $uuid;
        $array['udp'] = true;

        if ($server['tls']) {
            $array['tls'] = true;
            $tlsSettings = $server['tls_settings'] ?? [];
            $array['skip-cert-verify'] = ($tlsSettings['allow_insecure'] ?? 0) == 1 ? true : false;
            $array['flow'] = !empty($server['flow']) ? $server['flow']: "";
            $array['client-fingerprint'] = !empty($tlsSettings['fingerprint']) ? $tlsSettings['fingerprint'] : 'chrome';
            if ($tlsSettings) {
                if (isset($tlsSettings['server_name']) && !empty($tlsSettings['server_name']))
                   $array['servername'] = $tlsSettings['server_name'];
                if ($server['tls'] == 2) {
                   $array['reality-opts'] = [];
                   $array['reality-opts']['public-key'] = $tlsSettings['public_key'];
                   $array['reality-opts']['short-id'] = $tlsSettings['short_id'];
                   $array['reality-opts']['support-x25519mlkem768'] = true;
                }
                if (!empty($tlsSettings['ech'])) {
                    if ($tlsSettings['ech'] === 'cloudflare') {
                        $array['ech-opts'] = [
                            'enable' => true,
                            'query-server-name' => 'cloudflare-ech.com'
                        ];
                    } elseif ($tlsSettings['ech'] === 'custom' && !empty($tlsSettings['ech_config'])) {
                        $array['ech-opts'] = [
                            'enable' => true,
                            'config' => is_array($tlsSettings['ech_config']) ? $tlsSettings['ech_config'] : [$tlsSettings['ech_config']]
                        ];
                    }
                }
            }
        }

        if ($server['network'] === 'tcp') {
            $tcpSettings = $server['network_settings'];
            if (isset($tcpSettings['header']['type']) && $tcpSettings['header']['type'] == 'http') {
                $array['network'] = $tcpSettings['header']['type'];
                if (isset($tcpSettings['header']['request']['headers']['Host'])) $array['http-opts']['headers']['Host'] = $tcpSettings['header']['request']['headers']['Host'];
                if (isset($tcpSettings['header']['request']['path'])) $array['http-opts']['path'] = $tcpSettings['header']['request']['path'];
            }
        }

        if ($server['network'] === 'ws') {
            $array['network'] = 'ws';
            if ($server['network_settings']) {
                $wsSettings = $server['network_settings'];
                $array['ws-opts'] = [];
                if (isset($wsSettings['path']) && !empty($wsSettings['path']))
                    $array['ws-opts']['path'] = $wsSettings['path'];
                if (isset($wsSettings['headers']['Host']) && !empty($wsSettings['headers']['Host']))
                    $array['ws-opts']['headers'] = ['Host' => $wsSettings['headers']['Host']];
            }
        }
        if ($server['network'] === 'grpc') {
            $array['network'] = 'grpc';
            if ($server['network_settings']) {
                $grpcSettings = $server['network_settings'];
                $array['grpc-opts'] = [];
                if (isset($grpcSettings['serviceName'])) $array['grpc-opts']['grpc-service-name'] = $grpcSettings['serviceName'];
            }
        }
        if ($server['network'] === 'xhttp') {
            $array['network'] = 'xhttp';
            if ($server['network_settings']) {
                $xhttpSettings = $server['network_settings'];
                $array['xhttp-opts'] = [];
                if (isset($xhttpSettings['path'])) $array['xhttp-opts']['path'] = $xhttpSettings['path'];
                if (isset($xhttpSettings['host'])) $array['xhttp-opts']['host'] = $xhttpSettings['host'];
                if (isset($xhttpSettings['mode'])) $array['xhttp-opts']['mode'] = $xhttpSettings['mode'];
                // 暂不支持extra
                //if (isset($xhttpSettings['extra'])) {
                    //$array['xhttp-opts']['headers'] = $xhttpSettings['extra']['headers'] ?? [];
                    //if (isset($xhttpSettings['extra']['xmux'])) {
                    //    $array['xhttp-opts']['sc-max-concurrent-posts'] = $xhttpSettings['extra']['xmux']['maxConcurrency'] ?? [];
                    //}

                //}
            }
        }
        if (isset($server['encryption']) && !empty($server['encryption']) && isset($server['encryption_settings']) && !empty($server['encryption_settings'])) {
            $encryptionSettings = $server['encryption_settings'];
            $array['encryption'] = $server['encryption'] ?? 'mlkem768x25519plus';
            $array['encryption'] .= '.' . $encryptionSettings['mode'] ?? 'native';
            $array['encryption'] .= '.' . $encryptionSettings['rtt'] ?? '1rtt';
            if (isset($encryptionSettings['client_padding']) && !empty($encryptionSettings['client_padding'])) {
                $array['encryption'] .= '.' . $encryptionSettings['client_padding'];
            }
            $array['encryption'] .= '.' . $encryptionSettings['password'] ?? '';
        }

        return $array;
    }

}
