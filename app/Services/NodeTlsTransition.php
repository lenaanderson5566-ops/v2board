<?php
namespace App\Services;

use App\Models\ServerV2box;
use App\Services\Actions\NodeV10Config;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** One durable, encrypted candidate per binding. Published subscription data stays unchanged until acknowledged. */
final class NodeTlsTransition
{
    public static function affected($a) {
        $table='v2_server_'.$a->node_type;
        $host=DB::table($table)->where('id',$a->node_id)->value('host');
        return DB::table($table)->where(fn($q)=>$q->where('id',$a->node_id)->orWhere('parent_id',$a->node_id))->where('host',$host)->orderBy('id')->get();
    }
    private static function proof($a): string {
        return hash('sha256',json_encode([$a->credential_id,$a->domain,$a->published_domain,$a->family,$a->enabled,$a->managed,$a->report_hash,$a->ipv4,$a->ipv6,self::affected($a)]));
    }
    public static function pending($a): ?array {
        if (!$a || ($a->tls_transition_state??'')!=='pending' || !$a->tls_transition) return null;
        try { $p=json_decode(Crypt::decryptString($a->tls_transition),true,512,JSON_THROW_ON_ERROR); }
        catch (\Throwable $e) { return null; }
        return $p['expires']>time() && hash_equals($p['proof'],self::proof($a)) ? $p : null;
    }
    public static function reconcile($a): void {
        if (($a->tls_transition_state??'')==='pending' && !self::pending($a)) self::fail($a->id);
    }
    private static function fail(int $id): void {
        DB::table('v2_node_ddns')->where('id',$id)->update(['tls_transition_state'=>'failed','tls_transition'=>null]);
        NodeDdnsService::event($id,'certificate_transition_failed');
    }
    public static function remoteCertificate(string $domain): array {
        $ip=filter_var($domain,FILTER_VALIDATE_IP);
        abort_unless($ip || (strlen($domain)<=253 && preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/Di',$domain)),422,'证书需要有效域名或 IP 地址');
        $san=($ip?'IP:':'DNS:').$domain;
        $path=tempnam(sys_get_temp_dir(),'node-cert-');
        abort_unless($path!==false,503,'无法准备节点证书');
        try {
            chmod($path,0600);
            file_put_contents($path,"[req]\ndistinguished_name=dn\n[dn]\n[extensions]\nsubjectAltName=".$san."\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n");
            $options=['config'=>$path,'digest_alg'=>'sha256','private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1'];
            $key=openssl_pkey_new($options); $csr=$key ? openssl_csr_new(['commonName'=>$domain],$key,$options) : false;
            $cert=$csr ? openssl_csr_sign($csr,null,$key,365,$options+['x509_extensions'=>'extensions'],random_int(1,PHP_INT_MAX)) : false;
            abort_unless($cert && openssl_x509_export($cert,$pem) && openssl_pkey_export($key,$private,null,$options),503,'无法生成节点证书');
            return ['tls_cert'=>$pem,'tls_key'=>$private];
        } finally { @unlink($path); }
    }
    public static function queue($a,$node,$affected): void {
        $tls=json_decode($node->tls_settings??'{}',true)?:[];
        abort_unless((int)$node->tls===1 && in_array($tls['cert_mode']??'',['http','dns','self','remote','file'],true),422,'请先配置有效的 TLS 证书模式');
        $caps=Cache::get('V2BOX_CAPABILITIES:'.$a->node_id,[]);
        abort_unless($a->node_type==='v2box' && in_array('certificate-transition-v1',$caps['features']??[],true),409,'请先升级 V2Box 并等待节点上报证书切换能力');
        abort_unless($affected->count()<=200,422,'单次最多同步 200 个关联节点');
        if (self::pending($a)) return;
        abort_unless(preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',$a->domain),422,'证书需要有效域名');
        $tls['server_name']=$a->domain; unset($tls['server_names'],$tls['pinned_peer_cert_sha256']);
        if (in_array($tls['cert_mode'],['http','dns','self'],true)) {
            $dir='/etc/v2box/certificates/'.$a->node_id.'/'.substr(hash('sha256',$a->domain),0,32);
            $tls['cert_file']=$dir.'/certificate.pem'; $tls['key_file']=$dir.'/private.key';
        }
        if ($tls['cert_mode']==='remote') $tls=array_replace($tls,self::remoteCertificate($a->domain));
        $addresses=[];
        foreach ($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $family) $addresses[$family]=$a->$family;
        $p=['id'=>bin2hex(random_bytes(16)),'expires'=>time()+86400,'proof'=>self::proof($a),'tls'=>$tls,'addresses'=>$addresses];
        DB::table('v2_node_ddns')->where('id',$a->id)->update(['tls_transition'=>Crypt::encryptString(json_encode($p)),'tls_transition_state'=>'pending']);
        NodeDdnsService::event($a->id,'certificate_transition_pending');
    }
    public static function overlay($node): array {
        $a=DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$node->id)->first();
        $p=self::pending($a);
        if (!$p) return [$node,null];
        $candidate=clone $node; $candidate->tls_settings=$p['tls'];
        return [$candidate,['id'=>$p['id'],'domain'=>$a->domain,'addresses'=>(object)$p['addresses']]];
    }
    public static function receipt(int $id,array $report): bool {
        $a=DB::table('v2_node_ddns')->where('node_type','v2box')->where('node_id',$id)->first();
        if (!$a) return false;
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($a,$id,$report){
            $a=DB::table('v2_node_ddns')->where('id',$a->id)->lockForUpdate()->first();
            DB::table('v2_server_v2box')->where(fn($q)=>$q->where('id',$id)->orWhere('parent_id',$id))->lockForUpdate()->get();
            if ($a && $a->tls_transition_state==='applied' && $a->tls_transition) {
                try { $done=json_decode(Crypt::decryptString($a->tls_transition),true,512,JSON_THROW_ON_ERROR); }
                catch (\Throwable $e) { return false; }
                return ($report['state']??'')==='applied' && ($done['id']??null)===($report['transitionId']??null) && hash_equals($done['hash'],$report['hash']);
            }
            $p=self::pending($a); $node=ServerV2box::find($id);
            if (!$p || !$node || !hash_equals(hash('sha256',json_encode(NodeV10Config::build($node))),$report['hash']) || $p['id']!==($report['transitionId']??null)) return false;
            if ($report['state']==='failed') { self::fail($a->id); return false; }
            if (!preg_match('/^[a-f0-9]{64}$/D',$report['certificateFingerprint']??'')) return false;
            // Recheck fresh DNS ownership and publication guards before committing any node changes.
            NodeDnsLifecycle::activateLocked($a->id,true,$p['tls'],$report['certificateFingerprint']);
            $a=DB::table('v2_node_ddns')->find($a->id);
            DB::table('v2_node_ddns')->where('id',$a->id)->update(['tls_transition'=>Crypt::encryptString(json_encode(['id'=>$p['id'],'hash'=>$report['hash']]))]);
            return true;
        }));
    }
}
