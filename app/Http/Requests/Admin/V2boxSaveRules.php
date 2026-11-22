<?php

namespace App\Http\Requests\Admin;

use App\Services\Actions\UpdateDefaultNodeLine;
use App\Services\Actions\UpdateManualNodeAddress;
use App\Services\NodeDisplayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

final class V2boxSaveRules
{
    private const PROTOCOL_RULES = [
        'protocol' => 'required|in:shadowsocks,vmess,vless,trojan,tuic,hysteria2,anytls,naive',
        'network' => 'required|in:tcp,ws,grpc,httpupgrade',
        'encryption' => 'nullable|in:none',
        'encryption_settings' => 'nullable|array|max:0',
        'trusted_x_forwarded_for' => 'nullable|array|max:0',
        'tls_settings.ech' => 'nullable|in:0',
        'tls_settings.reject_unknown_sni' => 'nullable|in:0',
        'tls_settings.xver' => 'nullable|in:0',
        'tls_settings.mldsa65Seed' => 'nullable|size:0',
        'tls_settings.server_names' => 'nullable|array|max:1',
        'network_settings.acceptProxyProtocol' => 'nullable|in:0',
        'cipher' => 'nullable|in:aes-128-gcm,aes-192-gcm,aes-256-gcm,chacha20-ietf-poly1305,xchacha20-ietf-poly1305,2022-blake3-aes-128-gcm,2022-blake3-aes-256-gcm',
    ];

    private static function saveRules(): array
    {
        return [
            'group_id' => 'present|array|max:100',
            'group_id.*' => 'integer|min:1|distinct',
            'route_id' => 'nullable|array',
            'route_id.*' => 'integer|min:1|distinct',
            'name' => 'required',
            'service_id' => 'nullable|integer|min:1',
            'host' => 'required',
            'listen_ip' => 'nullable',
            'port' => 'required',
            'server_port' => 'required|integer|between:1,65535',
            'protocol' => self::PROTOCOL_RULES['protocol'],
            'tls' => 'required|in:0,1,2',
            'tls_settings' => 'nullable|array',
            'flow' => 'nullable|in:xtls-rprx-vision',
            'network' => self::PROTOCOL_RULES['network'],
            'network_settings' => 'nullable|array',
            'trusted_x_forwarded_for' => self::PROTOCOL_RULES['trusted_x_forwarded_for'],
            'encryption' => self::PROTOCOL_RULES['encryption'],
            'encryption_settings' => self::PROTOCOL_RULES['encryption_settings'],
            'disable_sni' => 'required|in:0,1',
            'udp_relay_mode' => 'nullable',
            'zero_rtt_handshake' => 'required|in:0,1',
            'congestion_control' => 'nullable',
            'cipher' => self::PROTOCOL_RULES['cipher'],
            'up_mbps' => 'nullable|numeric',
            'down_mbps' => 'nullable|numeric',
            'obfs' => 'nullable',
            'obfs_password' => 'nullable',
            'padding_scheme' => 'nullable',
            'tags' => 'nullable|array',
            'region_code' => 'nullable|string|size:2|in:' . implode(',', NodeDisplayService::regionCodes()),
            'city_code' => 'nullable|string|max:64|regex:/^[a-z0-9][a-z0-9-]*$/',
            'display_label' => 'nullable|string|max:64',
            'rate' => UpdateDefaultNodeLine::RATE_RULE,
            'show' => 'nullable|in:0,1',
            'sort' => 'nullable'
        ];
    }

    public static function formRules(): array
    {
        return array_filter(self::saveRules(), fn($key) => !str_contains($key, '.')
            && !in_array($key, ['encryption', 'encryption_settings', 'trusted_x_forwarded_for'], true), ARRAY_FILTER_USE_KEY);
    }

    public static function validateProtocol(Request $request): void
    {
        $request->validate(self::PROTOCOL_RULES + [
            'sing_box' => 'prohibited',
            'source_type' => 'prohibited',
            'source_id' => 'prohibited',
        ]);
        if (in_array($request->input('protocol'), ['shadowsocks', 'tuic', 'hysteria2', 'anytls', 'naive'], true)) {
            $request->validate(['network' => 'required|in:tcp']);
        }
        if ((int) $request->input('tls') === 2) {
            $request->validate(['protocol' => 'required|in:vless']);
        }
        if ($request->input('protocol') === 'naive') {
            $request->validate([
                'tls' => 'required|in:1',
                'disable_sni' => 'required|in:0',
                'tls_settings.cert_mode' => 'required|in:http,dns,file',
                'tls_settings.server_name' => $request->has('deployment_setup') ? 'nullable|string|max:253' : 'required|string|max:253',
                'tls_settings.allow_insecure' => 'nullable|in:0',
                'tls_settings.allowInsecure' => 'nullable|in:0',
                'tls_settings.cert_file' => 'nullable|required_if:tls_settings.cert_mode,file|string',
                'tls_settings.key_file' => 'nullable|required_if:tls_settings.cert_mode,file|string',
                'flow' => 'nullable|size:0',
            ]);
        }
        $network = $request->input('network');
        $allowed = ['acceptProxyProtocol'];
        if ($network === 'grpc') $allowed[] = 'serviceName';
        if (in_array($network, ['ws', 'httpupgrade'], true)) $allowed = array_merge($allowed, ['path', 'host', 'headers']);
        if ($network === 'ws') $allowed = array_merge($allowed, ['maxEarlyData', 'earlyDataHeaderName']);
        $request->validate(['network_settings' => 'nullable|array:' . implode(',', $allowed)]);
    }

    public static function validateDeployment(Request $request): array
    {
        return Validator::make($request->all(), [
            'deployment_setup' => 'required|array:credential_id,prefix,family,server_id,entry_id,entry_port',
            'deployment_setup.credential_id' => 'required|integer|min:1',
            'deployment_setup.prefix' => 'nullable|string|max:63',
            'deployment_setup.family' => 'required|in:ipv4,ipv6,dual',
            'deployment_setup.server_id' => 'nullable|integer|min:1',
            'deployment_setup.entry_id' => 'required_with:deployment_setup.entry_port|nullable|integer|min:1',
            'deployment_setup.entry_port' => 'required_with:deployment_setup.entry_id|nullable|integer|between:1,65535',
            'server_port' => 'required|integer|between:1,65535',
        ])->validate();
    }

    // Managed lines and deployment setup can supply fields inside the save transaction.
    public static function validateNormalized(Request $request): array
    {
        $rules = self::saveRules();
        $rules['port'] = [$rules['port'], UpdateManualNodeAddress::validatePort(...)];
        return $request->validate($rules, NodeDisplayService::validationMessages());
    }
}
