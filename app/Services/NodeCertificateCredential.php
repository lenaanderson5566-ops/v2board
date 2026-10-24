<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;

/** References stay in stored TLS settings; plaintext is resolved only for node delivery. */
final class NodeCertificateCredential {
    public static function credential(array $tls) {
        $id=$tls['dns_credential_id']??null;
        if (!$id) return null;
        abort_unless(filter_var($id,FILTER_VALIDATE_INT) && (int)$id>0,422,'请选择有效的证书 DNS 凭据');
        abort_unless(($tls['cert_mode']??'')==='dns',422,'已有 Cloudflare 凭据仅用于 DNS 申请证书');
        $credential=DB::table('v2_ddns_credential')->find((int)$id);
        abort_unless($credential && $credential->root_domain && $credential->next_run>=0,422,'证书 DNS 凭据不存在、未验证根域名或已暂停');
        abort_unless(is_string($tls['server_name']??null),422,'证书域名必须为单个域名');
        $domain=strtolower(rtrim($tls['server_name'],'.'));
        $root=strtolower($credential->root_domain);
        abort_unless(preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/D',$domain) && ($domain===$root || str_ends_with($domain,'.'.$root)),422,'证书域名不属于所选 Cloudflare 凭据的根域名');
        abort_if(!empty($tls['server_names']),422,'已有 Cloudflare 凭据仅支持单个证书域名');
        return $credential;
    }
    public static function normalize(array $tls): array {
        if (empty($tls['dns_credential_id'])) { unset($tls['dns_credential_id']); return $tls; }
        self::credential($tls);
        $tls['dns_credential_id']=(int)$tls['dns_credential_id'];
        $tls['provider']='cloudflare'; unset($tls['dns_env']);
        return $tls;
    }
    public static function resolve(array $tls): array {
        $c=self::credential($tls);
        unset($tls['dns_credential_id']);
        if (!$c) return $tls;
        try { $token=Crypt::decryptString($c->secret); }
        catch (\Throwable $e) { abort(422,'证书 DNS 凭据无法解密，请重新保存凭据'); }
        abort_unless(preg_match('/^[A-Za-z0-9_.-]+$/D',$token),422,'证书 DNS 凭据格式无效');
        $tls['provider']='cloudflare'; $tls['dns_env']='CF_DNS_API_TOKEN='.$token;
        return $tls;
    }
    public static function referenced(int $id): bool {
        foreach (['v2_server_v2box','v2_server_v2node'] as $table)
            if (DB::table($table)->where('tls_settings->dns_credential_id',$id)->exists()) return true;
        return false;
    }
}
