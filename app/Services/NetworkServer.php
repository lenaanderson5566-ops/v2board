<?php
namespace App\Services;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** Physical reporting identity. Domain snapshots are updated without contacting DNS providers. */
final class NetworkServer {
    public static function attach(int $binding, ?int $server=null): int {
        $a=DB::table('v2_node_ddns')->find($binding);
        abort_unless($a,404);
        abort_if(DB::table('v2_node_ddns')->where('server_id',$server ?: $a->server_id)->where('id','!=',$binding)->count()>=100,422,'一台服务器最多关联 100 个域名');
        $id=$server ?: ($a->server_id??null);
        if ($a->server_id && $id!=$a->server_id && in_array($a->node_type,['v2node','v2box'],true)) ProxyService::assertUnused($a->node_type,(int)$a->node_id);
        if (!$id) {
            $data=['name'=>$a->node_type.' #'.$a->node_id,'family'=>$a->family,'report_hash'=>$a->report_hash];
            if (in_array($a->node_type,['v2node','v2box'],true)) $data['name']=mb_substr(DB::table('v2_server_'.$a->node_type)->where('id',$a->node_id)->value('name') ?: $data['name'],0,100);
            foreach(['ipv4','ipv6'] as $f) { $data[$f]=$a->$f; $data[$f.'_seen_at']=$a->{$f.'_seen_at'}; }
            $id=DB::table('v2_network_server')->insertGetId($data);
        }
        $s=DB::table('v2_network_server')->find($id);
        abort_unless($s && $s->enabled && ($s->family==='dual' || $s->family===$a->family),422,'服务器地址类型不包含此域名所需的地址');
        $data=['server_id'=>$id];
        if ($a->server_id!=$id) {
            $data+=['report_hash'=>null,'tls_transition'=>null,'tls_transition_state'=>'none','relay_verified_at'=>0];
            foreach(['ipv4','ipv6'] as $f) { $data[$f]=$s->$f; $data[$f.'_seen_at']=$s->{$f.'_seen_at'}; }
        }
        DB::table('v2_node_ddns')->where('id',$binding)->update($data);
        return $id;
    }
    public static function credential(int $id,bool $rotate=false): array {
        $s=DB::table('v2_network_server')->where('id',$id)->lockForUpdate()->first();
        abort_unless($s && $s->enabled,409,'服务器已停用');
        $secret=$s->report_secret ? Crypt::decryptString($s->report_secret) : null;
        if ($rotate || !$secret) {
            $secret=bin2hex(random_bytes(32));
            DB::table('v2_network_server')->where('id',$id)->update(['report_hash'=>hash('sha256',$secret),'report_secret'=>Crypt::encryptString($secret)]);
            DB::table('v2_node_ddns')->where('server_id',$id)->update(['report_hash'=>null]);
        }
        return ['token'=>$secret,'family'=>$s->family,'serverId'=>$id];
    }
    public static function target($a) {
        if (!$a->entry_id) return $a;
        $entry=DB::table('v2_node_ddns')->find($a->entry_id);
        abort_unless($entry && $entry->purpose==='entry' && $entry->enabled,409,'入口域名不存在或已停用');
        return $entry;
    }
    public static function ready($a): bool {
        if (!$a || !$a->enabled || !in_array($a->status,['healthy','ready_to_switch'],true) || $a->last_success<time()-900) return false;
        if ($a->server_id && !DB::table('v2_network_server')->where('id',$a->server_id)->where('enabled',true)->exists()) return false;
        foreach($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $f) {
            if (!$a->$f || $a->{$f.'_seen_at'}<time()-900 || !DB::table('v2_node_dns_record')->where('assignment_id',$a->id)->where('credential_id',$a->credential_id)->where('domain',$a->domain)->where('type',$f==='ipv4'?'A':'AAAA')->where('content',$a->$f)->whereNotNull('record_id')->where('status','active')->where('delete_after',0)->exists()) return false;
        }
        return true;
    }
    public static function addresses($a): array {
        $ips=[]; foreach($a->family==='dual'?['ipv4','ipv6']:[$a->family] as $f) if ($a->$f) $ips[$f]=$a->$f;
        return $ips;
    }
    public static function tls($a,array $tls): void {
        if (!$a->entry_id) return;
        abort_unless(in_array($tls['cert_mode']??'',['dns','file','remote'],true),422,'四层中转请使用 DNS 验证申请证书，或提供已签发的证书');
        abort_if(($tls['cert_mode']??'')==='dns' && (empty($tls['provider']) || empty($tls['dns_env'])),422,'请单独配置证书 DNS 验证凭据');
    }
}
