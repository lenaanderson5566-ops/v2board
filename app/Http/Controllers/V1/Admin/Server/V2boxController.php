<?php
namespace App\Http\Controllers\V1\Admin\Server;

use App\Models\ServerV2box;
use Illuminate\Http\Request;

class V2boxController extends V2nodeController
{
    protected $model = ServerV2box::class;

    public const RULES = [
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

    public function save(Request $request)
    {
        $request->validate(self::RULES);
        if (in_array($request->input('protocol'), ['shadowsocks', 'tuic', 'hysteria2', 'anytls'], true)) {
            $request->validate(['network' => 'required|in:tcp']);
        }
        if ((int) $request->input('tls') === 2) {
            $request->validate(['protocol' => 'required|in:vless']);
        }
        $network = $request->input('network');
        $allowed = ['acceptProxyProtocol'];
        if ($network === 'grpc') $allowed[] = 'serviceName';
        if (in_array($network, ['ws', 'httpupgrade'], true)) $allowed = array_merge($allowed, ['path', 'host', 'headers']);
        if ($network === 'ws') $allowed = array_merge($allowed, ['maxEarlyData', 'earlyDataHeaderName']);
        $request->validate(['network_settings' => 'nullable|array:' . implode(',', $allowed)]);
        return parent::save($request);
    }
}
