<?php

namespace App\Http\Controllers\V1\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\ServerV2node;
use Illuminate\Http\Request;
use ParagonIE_Sodium_Compat as SodiumCompat;
use App\Utils\Helper;

class V2nodeController extends Controller
{
    protected $model = ServerV2node::class;

    protected function protocolRule()
    {
        return 'required|in:shadowsocks,vmess,vless,trojan,tuic,hysteria2,anytls';
    }

    protected function extraParams(Request $request): array { return []; }

    public function save(Request $request)
    {
        $request->merge(\App\Services\NodeDisplayService::normalizeInput($request->all()));
        $params = $request->validate([
            'group_id' => 'required',
            'route_id' => 'nullable|array',
            'route_id.*' => 'integer|min:1|distinct',
            'name' => 'required',
            'parent_id' => 'nullable|integer',
            'host' => 'required',
            'listen_ip' => 'nullable',
            'port' => 'required',
            'server_port' => 'required',
            'protocol' => $this->protocolRule(),
            'tls' => 'required|in:0,1,2',
            'tls_settings' => 'nullable|array',
            'flow' => 'nullable|in:xtls-rprx-vision',
            'network' => 'required|in:tcp,ws,grpc,http,httpupgrade,xhttp',
            'network_settings' => 'nullable|array',
            'trusted_x_forwarded_for' => 'nullable|array',
            'encryption' => 'nullable',
            'encryption_settings' => 'nullable|array',
            'disable_sni' => 'required|in:0,1',
            'udp_relay_mode' => 'nullable',
            'zero_rtt_handshake' => 'required|in:0,1',
            'congestion_control' => 'nullable',
            'cipher' => 'nullable',
            'up_mbps' => 'nullable|numeric',
            'down_mbps' => 'nullable|numeric',
            'obfs' => 'nullable',
            'obfs_password' => 'nullable',
            'padding_scheme' => 'nullable',
            'tags' => 'nullable|array',
            'region_code' => 'nullable|string|size:2|in:' . implode(',', \App\Services\NodeDisplayService::regionCodes()),
            'city_code' => 'nullable|string|max:64|regex:/^[a-z0-9][a-z0-9-]*$/',
            'display_label' => 'nullable|string|max:64',
            'rate' => 'required',
            'show' => 'nullable|in:0,1',
            'sort' => 'nullable'
        ], \App\Services\NodeDisplayService::validationMessages());
        $params = array_merge($params, $this->extraParams($request));
        $backend = $this->model === \App\Models\ServerV2box::class ? 'v2box' : 'v2node';
        if (array_key_exists('route_id', $params)) {
            $selected = \App\Services\NodeRouteService::selected($params['route_id'] ?? [], $backend);
            if ($backend === 'v2box') \App\Services\NodeRouteService::native($selected);
        }
        if ($params['protocol'] == 'anytls' && $params['tls'] === 0) {
            $params['tls'] = 1;
        }
        if (in_array($params['protocol'], ['hysteria2', 'trojan', 'tuic'])) {
            $params['tls'] = 1;
        }
        if (isset($params['tls']) && (int)$params['tls'] === 2) {
            $keyPair = SodiumCompat::crypto_box_keypair();
            $params['tls_settings'] = $params['tls_settings'] ?? [];
            if (!isset($params['tls_settings']['public_key'])) {
                $params['tls_settings']['public_key'] = Helper::base64EncodeUrlSafe(SodiumCompat::crypto_box_publickey($keyPair));
            }
            if (!isset($params['tls_settings']['private_key'])) {
                $params['tls_settings']['private_key'] = Helper::base64EncodeUrlSafe(SodiumCompat::crypto_box_secretkey($keyPair));
            }
            if (!isset($params['tls_settings']['short_id'])) {
                $params['tls_settings']['short_id'] = substr(sha1($params['tls_settings']['private_key']), 0, 8);
            }
            if (!isset($params['tls_settings']['server_port'])) {
                $params['tls_settings']['server_port'] = "443";
            }
        }
        if (isset($params['tls_settings']) && !empty($params['tls_settings']['ech']) && $params['tls_settings']['ech'] === 'custom') {
            if (empty($params['tls_settings']['ech_server_name'])) {
                $params['tls_settings']['ech'] = '';
            } else {
                $outerSni = $params['tls_settings']['ech_server_name'];
                if (empty($params['tls_settings']['ech_key']) || empty($params['tls_settings']['ech_config'])) {
                    $echPair = Helper::generateEchKeyPair($outerSni);
                    if (empty($params['tls_settings']['ech_key'])) {
                        $params['tls_settings']['ech_key'] = $echPair['ech_key'];
                    }
                    if (empty($params['tls_settings']['ech_config'])) {
                        $params['tls_settings']['ech_config'] = $echPair['ech_config'];
                    }
                }
            }
        }
        if (isset($params['tls']) && !empty($params['tls_settings']['cert_mode']) && $params['tls_settings']['cert_mode'] === 'remote') {
            if (!isset($params['tls_settings']['pinned_peer_cert_sha256'])) {
                $sni = $params['tls_settings']['server_name'] ?? 'example.com';
                $key = openssl_pkey_new([
                    "private_key_type" => OPENSSL_KEYTYPE_EC,
                    "curve_name" => "prime256v1"
                ]);
                if ($key === false) {
                    abort(500, '创建失败');
                }

                $csr = openssl_csr_new([
                    'commonName' => $sni
                ], $key, [
                    'digest_alg' => 'sha256'
                ]);

                if ($csr === false) {
                    abort(500, '创建失败');
                }

                $cert = openssl_csr_sign(
                    $csr,
                    null,
                    $key,
                    3650,
                    [
                        'digest_alg' => 'sha256'
                    ]
                );

                if ($cert === false) {
                    abort(500, '创建失败');
                }

                if (!openssl_pkey_export($key, $tlsKey)) {
                    abort(500, '创建失败');
                }

                if (!openssl_x509_export($cert, $tlsCert)) {
                    abort(500, '创建失败');
                }

                $certDer = base64_decode(
                    preg_replace(
                        '/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/',
                        '',
                        $tlsCert
                    ),
                    true
                );

                if ($certDer === false) {
                    abort(500, '创建失败');
                }

                $tlsPin = hash('sha256', $certDer);
                $params['tls_settings']['tls_cert'] = $tlsCert;
                $params['tls_settings']['tls_key'] = $tlsKey;
                $params['tls_settings']['pinned_peer_cert_sha256'] = $tlsPin;
            }
        }
        if (isset($params['network_settings'])) {
            $ns = $params['network_settings'];
            if (isset($ns['acceptProxyProtocol'])) {
                $ns['acceptProxyProtocol'] = filter_var($ns['acceptProxyProtocol'], FILTER_VALIDATE_BOOLEAN);
            }
            $params['network_settings'] = $ns;
        }
        if ($params['network'] != 'tcp' && isset($params['encryption']) && $params['encryption'] != 'mlkem768x25519plus') {
            $params['flow'] = null;
        }
        if ($params['network'] == 'xhttp' && isset($params['network_settings'])) {
            $ns = $params['network_settings'];
            if (isset($ns['extra']) && is_array($ns['extra'])) {
                $extra = $ns['extra'];
                if (isset($extra['xPaddingObfsMode'])) {
                    $extra['xPaddingObfsMode'] = filter_var($extra['xPaddingObfsMode'], FILTER_VALIDATE_BOOLEAN);
                }
                if (isset($extra['noGRPCHeader'])) {
                    $extra['noGRPCHeader'] = filter_var($extra['noGRPCHeader'], FILTER_VALIDATE_BOOLEAN);
                }
                if (isset($extra['noSSEHeader'])) {
                    $extra['noSSEHeader'] = filter_var($extra['noSSEHeader'], FILTER_VALIDATE_BOOLEAN);
                }
                if (isset($extra['scMaxBufferedPosts'])) {
                    $extra['scMaxBufferedPosts'] = (int)$extra['scMaxBufferedPosts'];
                }
                if (isset($extra['xmux']) && is_array($extra['xmux'])) {
                    $xmux = $extra['xmux'];
                    if (isset($xmux['hKeepAlivePeriod'])) {
                        $xmux['hKeepAlivePeriod'] = (int)$xmux['hKeepAlivePeriod'];
                    }
                    $extra['xmux'] = $xmux;
                }
                if (isset($extra['downloadSettings']) && is_array($extra['downloadSettings'])) {
                    $downloadSettings = $extra['downloadSettings'];
                    if (isset($downloadSettings['port'])) {
                        $downloadSettings['port'] = (int)$downloadSettings['port'];
                    }
                    $extra['downloadSettings'] = $downloadSettings;
                }
                $ns['extra'] = $extra;
            }
            $params['network_settings'] = $ns;
        }
        if (isset($params['encryption']) && $params['encryption'] == 'mlkem768x25519plus') {
            $keyPair = SodiumCompat::crypto_box_keypair();
            $params['encryption_settings'] = $params['encryption_settings'] ?? [];
            if (!isset($params['encryption_settings']['mode'])) {
                $params['encryption_settings']['mode'] = 'native';
            }
            if (isset($params['encryption_settings']['rtt'])) {
                if ($params['encryption_settings']['rtt'] == '1rtt') {
                    $params['encryption_settings']['ticket'] = '0s';
                }
            } else {
                $params['encryption_settings']['rtt'] = '0rtt';
                $params['encryption_settings']['ticket'] = '600s';
            }
            if (!isset($params['encryption_settings']['private_key'])) {
                $params['encryption_settings']['private_key'] = Helper::base64EncodeUrlSafe(SodiumCompat::crypto_box_secretkey($keyPair));
            }
            if (!isset($params['encryption_settings']['password'])) {
                $params['encryption_settings']['password'] = Helper::base64EncodeUrlSafe(SodiumCompat::crypto_box_publickey($keyPair));
            }
        }

        if (isset($params['padding_scheme'])) {
            $params['padding_scheme'] = json_decode($params['padding_scheme']);
        }

        if (!isset($params['up_mbps'])) {
            $params['up_mbps'] = 0;
        }
        if (!isset($params['down_mbps'])) {
            $params['down_mbps'] = 0;
        }

        if (isset($params['obfs'])) {
            if (!isset($params['obfs_password']))  $params['obfs_password'] = Helper::getServerKey($request->input('created_at'), 16);
        } else {
            $params['obfs_password'] = null;
        }

        if ($params['protocol'] == 'shadowsocks' && !isset($params['cipher'])) {
            $params['cipher'] = 'aes-128-gcm';
        }

        if ($request->has('source_type') || $request->has('source_id')) {
            $conversion = $request->validate(['source_type'=>'required|in:v2node,v2box', 'source_id'=>'required|integer|min:1', 'id'=>'prohibited']);
            $server = \App\Services\Actions\ConvertNodeBackend::run($conversion['source_type'], (int)$conversion['source_id'], $backend, $params);
            return response(['data'=>['id'=>$server->id, 'type'=>$backend]]);
        }

        if ($request->input('id')) {
            $server = $this->model::find($request->input('id'));
            if (!$server) {
                abort(500, '服务器不存在');
            }
            if (!empty($params['parent_id'])) {
                abort_if(\Illuminate\Support\Facades\DB::table('v2_server_traffic_binding')->where('node_type',$backend)->where('node_id',$server->id)->exists(),422,'请先解除服务器额度绑定，再设置为子节点');
                abort_if(\Illuminate\Support\Facades\DB::table('v2_lightsail_server')->where('node_type',$backend)->where('node_id',$server->id)->exists(),422,'请先移除 Lightsail 配置，再设置为子节点');
            }
            try {
                $server->update($params);
            } catch (\Exception $e) {
                abort(500, '保存失败');
            }
            return response([
                'data' => true
            ]);
        }

        if (!$this->model::create($params)) {
            abort(500, '创建失败');
        }
        return response([
            'data' => true
        ]);
    }

    public function drop(Request $request)
    {
        if ($request->input('id')) {
            $server = $this->model::find($request->input('id'));
            if (!$server) {
                abort(500, '节点ID不存在');
            }
        }
        return response([
            'data' => \Illuminate\Support\Facades\DB::transaction(function()use($server){
                $server=$this->model::whereKey($server->id)->lockForUpdate()->firstOrFail();
                $type=$this->model===\App\Models\ServerV2box::class ? 'v2box' : 'v2node';
                $cloud=\Illuminate\Support\Facades\DB::table('v2_lightsail_server')->where('node_type',$type)->where('node_id',$server->id)->lockForUpdate()->first();
                abort_if($cloud,409,'请先移除 Lightsail 配置再删除节点');
                return $server->delete();
            })
        ]);
    }

    public function update(Request $request)
    {
        $params = $request->validate([
            'show' => 'nullable|in:0,1',
        ]);

        $server = $this->model::find($request->input('id'));

        if (!$server) {
            abort(500, '该服务器不存在');
        }
        try {
            $server->update($params);
        } catch (\Exception $e) {
            abort(500, '保存失败');
        }
        return response([
            'data' => true
        ]);
    }

    public function copy(Request $request)
    {
        $server = $this->model::find($request->input('id'));
        if (!$server) {
            abort(500, '服务器不存在');
        }
        $server->show = 0;
        if (!$this->model::create($server->toArray())) {
            abort(500, '复制失败');
        }

        return response([
            'data' => true
        ]);
    }
}
