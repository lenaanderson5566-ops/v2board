<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/** Read-only public-path checks. Never issue certificates, change DNS or publish a route. */
class NodeDeploymentCheck
{
    public static function hostname(string $host): bool
    {
        return strlen($host) <= 253 && (bool) preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iD', $host);
    }

    public function resolve(string $host): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) return [$host];
        if (!self::hostname($host)) throw new \RuntimeException('invalid_host');
        $ips = [];
        foreach (['A'=>1, 'AAAA'=>28] as $type=>$number) {
            $response = Http::acceptJson()->withoutRedirecting()->connectTimeout(2)->timeout(3)
                ->withOptions(['proxy'=>''])->get('https://dns.google/resolve', ['name'=>$host, 'type'=>$type]);
            if (!$response->successful() || $response->json('Status') !== 0) throw new \RuntimeException('dns_unavailable');
            foreach ($response->json('Answer', []) as $answer) {
                if (($answer['type'] ?? null) === $number) $ips[] = $answer['data'];
            }
        }
        return array_values(array_unique($ips));
    }

    /** Pin the vetted IP: no second DNS lookup, HTTP request, redirect or proxy. */
    public function connect(string $host, string $ip, int $port, ?string $identity): array
    {
        if (!NodeDdnsService::publicAddress($ip, str_contains($ip, ':') ? 6 : 4)
            || $port < 1 || $port > 65535 || ($identity !== null && !self::hostname($identity)))
            return ['state'=>'unknown', 'code'=>'unsafe_target'];
        $name = $identity ?? $host;
        if (!self::hostname($name) && !filter_var($name, FILTER_VALIDATE_IP)) return ['state'=>'unknown', 'code'=>'unsafe_target'];
        $literal = str_contains($ip, ':') ? '['.$ip.']' : $ip;
        $urlHost = str_contains($name, ':') ? '['.$name.']' : $name;
        $curl = curl_init(($identity === null ? 'http' : 'https').'://'.$urlHost.':'.$port);
        curl_setopt_array($curl, [CURLOPT_CONNECT_ONLY=>true, CURLOPT_RETURNTRANSFER=>true,
            CURLOPT_PROXY=>'', CURLOPT_FOLLOWLOCATION=>false, CURLOPT_CONNECTTIMEOUT_MS=>2000,
            CURLOPT_TIMEOUT_MS=>2500, CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2,
            CURLOPT_CERTINFO=>true, CURLOPT_RESOLVE=>filter_var($name,FILTER_VALIDATE_IP)?[]:[$name.':'.$port.':'.$literal]]);
        try {
            $ok = curl_exec($curl); $errno = curl_errno($curl);
            $certificates = curl_getinfo($curl, CURLINFO_CERTINFO);
            if ($ok === false) return ['state'=>in_array($errno, [51,60], true) ? 'fail' : 'unknown', 'code'=>in_array($errno, [51,60], true) ? 'certificate_invalid' : 'unreachable', 'connected'=>curl_getinfo($curl,CURLINFO_CONNECT_TIME)>0];
            if ($identity === null) return ['state'=>'pass', 'code'=>'tcp_connected'];
            $pem = $certificates[0]['Cert'] ?? '';
            $cert = $pem ? openssl_x509_parse($pem) : false;
            if (!$cert) return ['state'=>'unknown', 'code'=>'certificate_unavailable'];
            return ['state'=>'pass', 'code'=>'tls_verified', 'fingerprint'=>openssl_x509_fingerprint($pem, 'sha256'),
                'expiresAt'=>(int)$cert['validTo_time_t']];
        } finally { curl_close($curl); }
    }

    public function endpoint(string $host, int $port, ?string $identity, bool $udp, array $expected=[]): array
    {
        $result = ['host'=>$host, 'port'=>$port, 'dns'=>'unknown', 'state'=>'unknown', 'code'=>'dns_unavailable', 'addresses'=>[]];
        if ($port < 1 || $port > 65535) return array_replace($result, ['code'=>'invalid_port']);
        try { $ips = $this->resolve($host); } catch (\Throwable $e) { return $result; }
        if (!$ips) return array_replace($result, ['dns'=>'fail', 'code'=>'dns_empty']);
        // Reject the entire answer if it contains unsafe addresses; never probe a safe subset.
        foreach ($ips as $ip) if (!NodeDdnsService::publicAddress($ip, str_contains($ip, ':') ? 6 : 4))
            return array_replace($result, ['dns'=>'fail', 'code'=>'unsafe_target']);
        if ($expected) {
            foreach ($expected as $ip) if (!NodeDdnsService::publicAddress($ip, str_contains($ip, ':') ? 6 : 4))
                return array_replace($result, ['code'=>'unsafe_target']);
            $canonical = fn($values)=>array_map(fn($ip)=>inet_ntop(inet_pton($ip)), $values);
            $actual=$canonical($ips); $wanted=$canonical($expected);
            if (array_diff($actual,$wanted) || array_diff($wanted,$actual))
                return array_replace($result, ['dns'=>'fail', 'code'=>'dns_mismatch']);
        }
        $result['dns']='pass';
        if ($udp) return array_replace($result, ['code'=>'udp_client_required']);
        if (count($ips)>2) return array_replace($result, ['code'=>'too_many_addresses']);
        foreach ($ips as $ip) {
            try { $check=$this->connect($host,$ip,$port,$identity); }
            catch (\Throwable $e) { $check=['state'=>'unknown','code'=>'probe_unavailable']; }
            $result['addresses'][]=['ip'=>$ip]+$check;
        }
        $failed=array_values(array_filter($result['addresses'],fn($r)=>$r['state']!=='pass'));
        $result['state']=$failed ? (in_array('fail',array_column($failed,'state'),true)?'fail':'unknown') : 'pass';
        $result['code']=$failed ? (in_array('certificate_invalid',array_column($failed,'code'),true)?'certificate_invalid':$failed[0]['code']) : ($identity ? 'tls_verified' : 'tcp_connected');
        return $result;
    }

    public function inspect(string $type, $node): array
    {
        $node=$node->fresh();
        abort_unless($node,404,'节点不存在');
        $root=$node->service_id ? (new ServerService())->getServer($node->service_id,$type) : $node;
        abort_unless($root,404,'代理服务不存在');
        $binding=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$root->id)->first();
        $tls=$root->tls_settings ?: [];
        $identity=(int)$root->tls===1 ? ($tls['server_name'] ?? '') : null;
        // No handshake with a guessed TLS identity or a Reality endpoint.
        $unsupported=(int)$root->tls===2 || ((int)$root->tls===1 && (!is_string($identity) || !self::hostname($identity)));
        $udp=in_array($root->protocol,['tuic','hysteria2'],true);
        $runtime=NodeRuntimeService::inspect($type,$node);
        $relay=(bool)($binding->entry_id ?? false);
        $entry=$relay ? DB::table('v2_node_ddns')->find($binding->entry_id) : null;
        $snapshot=hash('sha256',json_encode([$root->getAttributes(),$binding,$entry]));
        $originHost=$binding && $binding->managed ? $binding->domain : $root->host;
        $originExpected=$binding && $binding->managed ? array_values(NetworkServer::addresses($binding)) : [];
        $origin=$this->endpoint($originHost,(int)$root->server_port,$unsupported ? null : $identity,$udp || $unsupported,$originExpected);
        $entryResult=$relay && $entry ? $this->endpoint($entry->domain,(int)$binding->entry_port,$unsupported ? null : $identity,$udp || $unsupported,array_values(NetworkServer::addresses($entry))) : null;
        $items=[];
        $add=function($key,$label,$state,$detail,$next)use(&$items){$items[]=compact('key','label','state','detail','next');};
        $applied=$runtime['applicationState']==='applied' && $runtime['runtimeStatus']==='online';
        $add('configuration','节点配置',$applied?'pass':'unknown',$applied?'节点已确认当前配置，且近期通信正常。':'尚未收到当前配置的有效应用确认。',$applied?'':'检查节点运行状态及到面板的连接；应用失败时查看节点日志。');
        if ($binding && $binding->managed) {
            $fresh=true;
            foreach (array_filter([$binding,$entry]) as $assignment) {
                if (!$assignment->enabled) $fresh=false;
                foreach ($assignment->family==='dual'?['ipv4','ipv6']:[$assignment->family] as $family)
                    if (!$assignment->$family || $assignment->{$family.'_seen_at'}<time()-900) $fresh=false;
            }
            $add('report','服务器 IP 上报',$fresh?'pass':'unknown',$fresh?'所需地址类型均有近期上报。':'入口或代理服务器尚未提供完整的近期 IP 上报。',$fresh?'':'分别检查入口和代理服务器的上报服务；仅配置为双栈的一侧需要 IPv4 与 IPv6，IPv4 回源不要求 IPv6。');
        }
        $dns=$origin['dns']==='pass' && (!$relay || ($entryResult['dns'] ?? '')==='pass');
        $add('dns','公网 DNS',$dns?'pass':(($origin['dns']==='fail' || ($entryResult['dns'] ?? '')==='fail')?'fail':'unknown'),$dns?'本次公网查询成功；存在已上报 IP 时，已核对解析地址。':'公网解析未确认或与已上报 IP 不一致。',$dns?'':'检查服务器 IP 上报、A/AAAA 记录及 DNS only 设置，解析传播后重新检查。');
        $listening=(bool)$origin['addresses'] && !array_filter($origin['addresses'],fn($a)=>!($a['connected'] ?? $a['state']==='pass'));
        $add('listener','节点监听',$listening?'pass':'unknown',$listening?'面板已连接代理服务器 TCP 端口；证书结果单独展示。':'面板未确认代理服务器监听端口可达。',$listening?'':'检查监听端口、安全组及防火墙。仅允许入口回源时，此项可能无法从面板验证。');
        $public=$relay ? $entryResult : (ctype_digit((string)$root->port) && (int)$root->port===(int)$root->server_port ? $origin : $this->endpoint($originHost,ctype_digit((string)$root->port)?(int)$root->port:0,$unsupported ? null : $identity,$udp || $unsupported,$originExpected));
        $certPass=!$unsupported && !$udp && $identity && ($public['state'] ?? '')==='pass';
        $expiry=$certPass ? min(array_column($public['addresses'],'expiresAt')) : null;
        $add('certificate','在线证书',$certPass?'pass':((int)$root->tls===0?'skip':(($public['code'] ?? '')==='certificate_invalid'?'fail':'unknown')),$certPass?'已验证证书信任链及 TLS 身份域名。':((int)$root->tls===0?'当前服务未使用 TLS 证书。':'尚未验证在线证书。'),$certPass?($expiry<time()+30*86400?'证书已进入续期窗口，请关注节点续期日志和到期时间变化。':''):((int)$root->tls===0?'':'检查证书域名、申请模式与 Cloudflare 凭据；UDP 和 Reality 需使用实际客户端验证。'));
        if ($expiry) $items[count($items)-1]['expiresAt']=$expiry;
        $originPrints=array_unique(array_column($origin['addresses'],'fingerprint'));
        $entryPrints=array_unique(array_column($entryResult['addresses'] ?? [],'fingerprint'));
        $relayPass=$relay && $certPass && $origin['state']==='pass' && count($originPrints)===1 && count($entryPrints)===1 && reset($originPrints)===reset($entryPrints);
        $add('relay','中转连接',!$relay?'skip':($relayPass?'pass':'unknown'),!$relay?'直连节点无需中转。':($relayPass?'入口与回源 TLS 握手成功，在线证书指纹一致；尚未验证代理协议鉴权与数据传输。':'尚未确认入口与回源的 TLS 连通性及证书一致性。'),!$relay?'':($relayPass?'使用实际客户端完成一次连接。':'检查 Nginx stream 的上游与端口。仅允许入口访问回源时，需从入口服务器或实际客户端进一步验证。'));
        if ($udp || $unsupported) foreach ($items as &$item) if (in_array($item['key'],['listener','certificate','relay'],true) && $item['state']!=='skip') {
            $item['detail']=$udp?'当前协议使用 UDP/QUIC，TCP 探测不能证明服务正常。':'当前 TLS 身份或 Reality 模式不支持普通 TLS 探测。';
            $item['next']='使用支持此协议的客户端验证，并结合节点日志检查；不会将端口无响应判为服务故障。';
        }
        unset($item);
        $add('renewal','自动续期',(int)$root->tls===1?'unknown':'skip',(int)$root->tls===1?'在线证书有效不代表已验证下一次续期；本检查不会发起证书申请。':'当前模式不使用普通 TLS 证书续期。',(int)$root->tls===1?'自动申请模式由 V2Box 定期检查续期；续期后重新检查证书到期时间。文件证书需由证书维护方更新。':'');
        $latestBinding=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$root->id)->first();
        $latestEntry=($latestBinding->entry_id ?? null)?DB::table('v2_node_ddns')->find($latestBinding->entry_id):null;
        $changed=$snapshot!==hash('sha256',json_encode([$root->fresh()?->getAttributes(),$latestBinding,$latestEntry]));
        if ($changed) foreach ($items as &$item) {
            $item['state']='unknown';$item['detail']='检查期间节点配置或服务器上报发生变化，本次结果已失效。';$item['next']='请重新执行一键检查。';unset($item['expiresAt']);
        }
        unset($item);
        return ['checkedAt'=>time(),'source'=>'panel','items'=>$items,'origin'=>$origin,'entry'=>$entryResult,
            'connection'=>$public,'identity'=>is_string($identity)?$identity:null,'note'=>'检查使用已保存的目标域名与端口；域名切换尚未完成时，当前订阅可能仍使用旧地址。结果反映面板到公网地址的本次连接结果，不替代客户端测试；不会修改 DNS、证书、节点或转发配置。'];
    }
}
