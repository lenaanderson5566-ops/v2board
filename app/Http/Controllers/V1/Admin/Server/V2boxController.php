<?php

namespace App\Http\Controllers\V1\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\ServerV2box;
use Illuminate\Http\Request;
use ParagonIE_Sodium_Compat as SodiumCompat;
use App\Utils\Helper;

class V2boxController extends Controller
{
    protected $model = ServerV2box::class;

    public static function saveRules(): array
    {
        return array_replace([
            'group_id' => 'present|array|max:100',
            'group_id.*' => 'integer|min:1|distinct',
            'route_id' => 'nullable|array',
            'route_id.*' => 'integer|min:1|distinct',
            'name' => 'required',
            'service_id' => 'nullable|integer|min:1',
            'host' => 'required',
            'listen_ip' => 'nullable',
            'port' => 'required',
            'server_port' => 'required',
            'protocol' => self::RULES['protocol'],
            'tls' => 'required|in:0,1,2',
            'tls_settings' => 'nullable|array',
            'flow' => 'nullable|in:xtls-rprx-vision',
            'network' => 'required|in:tcp,ws,grpc,httpupgrade',
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
        ], array_filter(self::RULES, fn($key) => !str_contains($key, '.'), ARRAY_FILTER_USE_KEY));
    }

    public static function formRules(): array
    {
        return array_filter(self::saveRules(), fn($key) => !str_contains($key, '.')
            && !in_array($key, ['encryption', 'encryption_settings', 'trusted_x_forwarded_for'], true), ARRAY_FILTER_USE_KEY);
    }

    private function persist(Request $request)
    {
        return \App\Services\NodeDnsLifecycle::locked(fn()=>\Illuminate\Support\Facades\DB::transaction(fn()=>$this->saveUnlocked($request)));
    }

    private function saveUnlocked(Request $request)
    {
        $setup=null; $pendingIdentity=null; $identityBinding=null;
        if ($request->has('deployment_setup')) {
            abort_if($request->input('id') || $request->input('service_id'),422,'一体化部署配置仅用于新增独立节点');
            $validated=\Illuminate\Support\Facades\Validator::make($request->all(),['deployment_setup'=>'required|array:credential_id,prefix,family,server_id,entry_id,entry_port',
                'deployment_setup.credential_id'=>'required|integer|min:1','deployment_setup.prefix'=>'nullable|string|max:63',
                'deployment_setup.family'=>'required|in:ipv4,ipv6,dual','deployment_setup.server_id'=>'nullable|integer|min:1',
                'deployment_setup.entry_id'=>'required_with:deployment_setup.entry_port|nullable|integer|min:1','deployment_setup.entry_port'=>'required_with:deployment_setup.entry_id|nullable|integer|between:1,65535',
                'server_port'=>'required|integer|between:1,65535'])->validate();
            $setup=$validated['deployment_setup'];
            $root=\Illuminate\Support\Facades\DB::table('v2_ddns_credential')->find($setup['credential_id']);
            abort_unless($root && $root->root_domain,422,'请先在域名与解析中维护并验证 Cloudflare 根域名');
            $setup['prefix']=strtolower($setup['prefix']??'') ?: 'n-'.bin2hex(random_bytes(5));
            $host=\App\Services\NodeDnsLifecycle::name($setup['prefix'],$root->root_domain);
            $entry=null;
            if (!empty($setup['entry_id'])) {
                $entry=\Illuminate\Support\Facades\DB::table('v2_node_ddns')->where('purpose','entry')->where('enabled',true)->find($setup['entry_id']);
                abort_unless($entry && \Illuminate\Support\Facades\DB::table('v2_network_server')->where('id',$entry->server_id)->where('enabled',true)->exists(),422,'请选择已启用服务器上的有效入口域名');
            }
            $originDomain=$host;
            $host=$entry ? $entry->domain : $host;
            $request->merge(['host'=>$host,'port'=>(int)($entry ? $setup['entry_port'] : $validated['server_port'])]);
            if ((int)$request->input('tls')===1) {
                $tls=$request->input('tls_settings',[]);
                abort_unless(is_array($tls),422,'TLS 配置必须为对象');
                $tls['server_name']=trim($tls['server_name']??'') ?: $originDomain;
                $request->merge(['tls_settings'=>$tls,'disable_sni'=>0]);
            }
        }
        $request->merge(['service_id'=>$request->input('service_id') ?: null]);
        $existing=$request->input('id') ? $this->model::find($request->input('id')) : null;
        $backend='v2box';
        if($existing && !$existing->service_id) $request->merge($existing->only(\App\Services\Actions\UpdateDefaultNodeLine::PRESERVED_FIELDS));
        abort_if($existing && (bool)$existing->service_id!==(bool)$request->input('service_id'),422,'代理服务与接入线路不能直接互换，请新增目标对象后迁移线路');
        abort_if($existing && \Illuminate\Support\Facades\DB::table('v2_node_connection')->where('node_type',$backend)->where('node_id',$existing->id)->exists(),409,'请通过接入线路编辑与发布，避免绕过入口校验');
        if ($request->input('service_id')) {
            $service=$this->model::find($request->input('service_id'));
            \App\Services\ProxyService::validate((object)['id'=>$existing->id??0,'group_id'=>$request->input('group_id',[])],$service);
            if ($existing) \App\Services\ProxyService::assertUnused($backend,$existing->id);
            $request->merge(\Illuminate\Support\Arr::except(\App\Services\ProxyService::overlay([],$service->toArray()),['created_at','updated_at','server_key']));
        } elseif ($existing && !$existing->service_id) {
            foreach($this->model::where('service_id',$existing->id)->get(['group_id']) as $line) {
                abort_if(array_diff((array)$line->group_id,(array)$request->input('group_id',[])),422,'权限组仍被关联线路使用，请先调整线路权限');
            }
        }
        $serviceSource=$existing;
        $serviceBackend=$backend;
        if($serviceSource && !$serviceSource->service_id && (int)$request->input('tls')===1){
            $managed=\Illuminate\Support\Facades\DB::table('v2_node_ddns')->where('node_type',$serviceBackend)->where('node_id',$serviceSource->id)->where('managed',true)->first();
            if($managed){
                $tls=$request->input('tls_settings',[]);
                abort_unless(is_array($tls),422,'TLS 配置必须为对象');
                $identity=(int)$serviceSource->tls===1 && !empty($serviceSource->tls_settings['server_name']) ? $serviceSource->tls_settings['server_name'] : $serviceSource->host;
                if (!empty($tls['server_name']) && $tls['server_name']!==$identity) {
                    abort_unless($existing && (int)$existing->tls===1,422,'TLS 身份切换需要已有 V2Box TLS 服务');
                    $identityBinding=$managed;
                    $pendingIdentity=true;
                }
                $tls['server_name']=($tls['server_name']??'') ?: $identity;
                if($managed->entry_id) \App\Services\NetworkServer::tls($managed,$tls);
                $request->merge(['tls_settings'=>$tls,'disable_sni'=>0]);
            }
        }
        $request->merge(\App\Services\NodeDisplayService::normalizeInput($request->all()));
        $params = $request->validate(self::saveRules(), \App\Services\NodeDisplayService::validationMessages());
        if (!empty($params['tls_settings']['dns_credential_id'])) {
            abort_unless((int)$params['tls']===1,422,'证书 DNS 凭据仅用于普通 TLS');
            $params['tls_settings']=\App\Services\NodeCertificateCredential::normalize($params['tls_settings']);
        }
        $backend = 'v2box';
        if (array_key_exists('route_id', $params)) {
            $selected = \App\Services\NodeRouteService::selected($params['route_id'] ?? [], $backend);
            \App\Services\NodeRouteService::native($selected);
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
        if (isset($params['tls']) && !empty($params['tls_settings']['cert_mode']) && $params['tls_settings']['cert_mode'] === 'remote') {
            if (!isset($params['tls_settings']['pinned_peer_cert_sha256'])) {
                $sni = $params['tls_settings']['server_name'] ?? 'example.com';
                $pair=\App\Services\NodeTlsTransition::remoteCertificate($sni);
                $tlsCert=$pair['tls_cert']; $tlsKey=$pair['tls_key'];
                $tlsPin=openssl_x509_fingerprint($tlsCert,'sha256');

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
        if ($params['network'] != 'tcp') {
            $params['flow'] = null;
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


        if ($request->input('id')) {
            $server = $this->model::find($request->input('id'));
            if (!$server) {
                abort(500, '服务器不存在');
            }
            if (!empty($params['service_id'])) {
                abort_if(\Illuminate\Support\Facades\DB::table('v2_node_ddns')->where('node_type',$backend)->where('node_id',$server->id)->exists(),422,'请先解除节点域名绑定，再设置为关联线路');
                abort_if(\Illuminate\Support\Facades\DB::table('v2_server_traffic_binding')->where('node_type',$backend)->where('node_id',$server->id)->exists(),422,'请先解除服务器额度绑定，再设置为关联线路');
                abort_if(\Illuminate\Support\Facades\DB::table('v2_lightsail_server')->where('node_type',$backend)->where('node_id',$server->id)->exists(),422,'请先移除 Lightsail 配置，再设置为关联线路');
            }
            if(!$server->service_id) $params=\Illuminate\Support\Arr::except($params,\App\Services\Actions\UpdateDefaultNodeLine::PRESERVED_FIELDS);
            $candidateTls=null;
            if ($pendingIdentity) { $candidateTls=$params['tls_settings']; $params['tls_settings']=$server->tls_settings; }
            $server->fill($params);
            \App\Services\NodeListenerGuard::check($backend,$server);
            try {
                $server->save();
                if ($candidateTls) {
                    \App\Services\NodeTlsTransition::queue($identityBinding,(object)$server->getAttributes(),\App\Services\NodeTlsTransition::affected($identityBinding),$candidateTls);
                    \App\Services\NodeRuntimeService::invalidate($backend,(int)$server->id);
                }
                if ($server->wasChanged()) \App\Services\NodeRuntimeService::invalidate($backend,(int)($server->service_id ?: $server->id));
            } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
                throw $e;
            } catch (\Exception $e) {
                abort(500, '保存失败');
            }
            return response([
                'data' => true
            ]);
        }

        if (!$created = $this->model::create($params)) {
            abort(500, '创建失败');
        }
        if ($setup) {
            (new \App\Http\Controllers\V1\Admin\NodeDomainController())->bindWithinLock(Request::create('/','POST',$setup+['node_type'=>$backend,'node_id'=>$created->id]));
            \App\Services\NodeListenerGuard::check($backend,$created->fresh());
            \App\Services\NodeDeploymentWorkflow::validate($created->fresh());
        }
        return response([
            'data' => ['id'=>$created->id,'type'=>$backend]
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
            'data' => \App\Services\NodeDnsLifecycle::locked(fn()=>\Illuminate\Support\Facades\DB::transaction(function()use($server){
                $server=$this->model::whereKey($server->id)->lockForUpdate()->firstOrFail();
                $type='v2box';
                \App\Services\ProxyService::assertUnused($type,$server->id);
                \App\Services\ProxyService::removeConnection($type,$server->id);
                $cloud=\Illuminate\Support\Facades\DB::table('v2_lightsail_server')->where('node_type',$type)->where('node_id',$server->id)->lockForUpdate()->first();
                abort_if($cloud,409,'请先移除 Lightsail 配置再删除节点');
                \App\Services\NodeCredentials::retire($type,(int)$server->id);
                \Illuminate\Support\Facades\DB::table('v2_node_maintenance')->where('type',$type)->where('node_id',$server->id)->delete();
                \App\Services\NodeDnsLifecycle::removeNode($type,(int)$server->id);
                return $server->delete();
            }))
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
        $backend='v2box';
        abort_if(!empty($params['show']) && \Illuminate\Support\Facades\DB::table('v2_node_connection')->where('node_type',$backend)->where('node_id',$server->id)->whereNull('published')->exists(),409,'请先验证并发布线路');
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
        abort_if($server->service_id,422,'请通过新增接入线路复用代理服务，避免复制入口监听规则');
        $server->show = 0;
        if (!$this->model::create($server->toArray())) {
            abort(500, '复制失败');
        }

        return response([
            'data' => true
        ]);
    }

    public const RULES = [
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

    public function save(Request $request)
    {
        $request->validate(self::RULES + ['sing_box'=>'prohibited','source_type'=>'prohibited','source_id'=>'prohibited']);
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
        return $this->persist($request);
    }
}
