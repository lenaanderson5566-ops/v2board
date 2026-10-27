<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;

class NodeDdnsFailure extends \RuntimeException {
    public $httpStatus; public $delay; public $credential;
    public function __construct(string $code, int $status=0, int $delay=300, bool $credential=false) {
        parent::__construct($code); $this->httpStatus=$status; $this->delay=$delay; $this->credential=$credential;
    }
}
class NodeDdnsService {
    public static function nodeExists($row): bool {
        if (($row->purpose??'')==='entry') return DB::table('v2_network_server')->where('id',$row->server_id)->exists();
        return in_array($row->node_type,['v2box'],true) && DB::table('v2_server_'.$row->node_type)->where('id',$row->node_id)->exists();
    }
    public static function publicAddress(string $ip, int $version): bool {
        $flag=($version===4 ? FILTER_FLAG_IPV4 : FILTER_FLAG_IPV6) | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        if (!filter_var($ip,FILTER_VALIDATE_IP,$flag)) return false;
        $packed=inet_pton($ip);
        // Exclude multicast and transition/documentation ranges PHP may accept.
        if ($version===4) return ord($packed[0]) < 224 && !str_starts_with($ip,'192.0.2.') && !str_starts_with($ip,'198.51.100.') && !str_starts_with($ip,'203.0.113.') && !(ord($packed[0])===100 && ord($packed[1])>=64 && ord($packed[1])<=127);
        return (ord($packed[0]) & 0xe0)===0x20 && substr($packed,0,4)!==hex2bin('20010db8');
    }
    public static function event(int $id, string $code, ?int $http=null): void {
        DB::table('v2_ddns_event')->insert(['assignment_id'=>$id,'code'=>$code,'http_status'=>$http,'created_at'=>time()]);
    }
    public function api($credential, string $method, string $path='', array $data=[], bool $zone=false): array {
        try {
            $token=Crypt::decryptString($credential->secret);
        } catch (\Throwable $e) { throw new NodeDdnsFailure('credential_unreadable',0,-1,true); }
        try {
            $response=Http::withToken($token)->acceptJson()->timeout(8)->withOptions(['connect_timeout'=>4])->withoutRedirecting()
                ->send($method,'https://api.cloudflare.com/client/v4/zones/'.$credential->zone_id.($zone ? '' : '/dns_records').$path,
                    $method==='GET' ? ['query'=>$data] : ['json'=>$data]);
        } catch (\Illuminate\Http\Client\ConnectionException $e) { throw new NodeDdnsFailure('network_error'); }
        $status=$response->status();
        if ($status===404 && in_array($method,['GET','DELETE'],true) && !$zone && $path!=='') return ['success'=>true,'result'=>null];
        if ($status===429) {
            $retry=$response->header('Retry-After');
            throw new NodeDdnsFailure('rate_limited',429,ctype_digit((string)$retry) ? max(300,min(86400,(int)$retry)) : 900,true);
        }
        if (in_array($status,[401,403],true)) throw new NodeDdnsFailure('credential_rejected',$status,-1,true);
        if ($status>=500) throw new NodeDdnsFailure('provider_unavailable',$status,900,true);
        if (!$response->successful()) throw new NodeDdnsFailure('configuration_rejected',$status,-1);
        $body=$response->json();
        if (!is_array($body) || ($body['success'] ?? false)!==true) throw new NodeDdnsFailure('provider_rejected',$status,-1);
        return $body;
    }
    public function sync(int $id): void {
        $initial=DB::table('v2_node_ddns')->find($id);
        if (!$initial) return;
        if ($initial->managed) { app(NodeDnsLifecycle::class)->sync($id); return; }
        // Serialize with credential edits and node reconfiguration, including manual command runs.
        NodeDnsLifecycle::locked(fn()=>DB::transaction(function () use ($id,$initial) {
            $credential=DB::table('v2_ddns_credential')->where('id',$initial->credential_id)->lockForUpdate()->first();
            $row=DB::table('v2_node_ddns')->where('id',$id)->lockForUpdate()->first();
            if (!$row || !$credential || $row->credential_id!==$initial->credential_id || !$row->enabled || $row->next_run<0 || $row->next_run>time() || $credential->next_run<0 || $credential->next_run>time()) return;
            if ($row->server_id && !DB::table('v2_network_server')->where('id',$row->server_id)->where('enabled',true)->exists()) return;
            $code='unchanged'; $http=null; $delay=300; $changed=false;
            try {
                if (!self::nodeExists($row)) throw new NodeDdnsFailure('node_missing',0,-1);
                $stale=false;
                foreach ($row->family==='dual' ? ['ipv4','ipv6'] : [$row->family] as $family) {
                    if (!$row->$family || $row->{$family.'_seen_at'}<time()-900) { $stale=true; continue; }
                    $type=$family==='ipv4' ? 'A' : 'AAAA';
                    $body=$this->api($credential,'GET','',['type'=>$type,'name'=>$row->domain,'per_page'=>100]);
                    $records=$body['result'] ?? null;
                    if (!is_array($records) || count($records)>1 || ($body['result_info']['total_pages'] ?? 1)>1) throw new NodeDdnsFailure('ambiguous_records',0,-1);
                    $record=$records[0] ?? null;
                    if ($record && (($record['name'] ?? '')!==$row->domain || ($record['type'] ?? '')!==$type)) throw new NodeDdnsFailure('unexpected_record',0,-1);
                    if ($record && ($record['content'] ?? '')===$row->$family && ($record['proxied'] ?? null)===false) continue;
                    if ($record && !preg_match('/^[a-f0-9]{32}$/i',$record['id'] ?? '')) throw new NodeDdnsFailure('unexpected_record',0,-1);
                    $this->api($credential,$record ? 'PATCH' : 'POST',$record ? '/'.$record['id'] : '',['type'=>$type,'name'=>$row->domain,'content'=>$row->$family,'ttl'=>300,'proxied'=>false]);
                    $changed=true;
                }
                $code=$stale ? 'awaiting_report' : 'healthy';
                if (!$stale) DB::table('v2_node_ddns')->where('id',$id)->update(['last_success'=>time()]);
                DB::table('v2_ddns_credential')->where('id',$credential->id)->update(['next_run'=>0,'status'=>'ready']);
            } catch (NodeDdnsFailure $e) {
                $code=$e->getMessage(); $http=$e->httpStatus ?: null; $delay=$e->delay;
                if ($e->credential) DB::table('v2_ddns_credential')->where('id',$credential->id)->update(['next_run'=>$delay<0 ? -1 : time()+$delay,'status'=>$code]);
            }
            DB::table('v2_node_ddns')->where('id',$id)->update(['status'=>$code,'next_run'=>$delay<0 ? -1 : time()+$delay]);
            if ($changed) self::event($id,'dns_updated');
            if ($code!==$row->status) self::event($id,$code,$http);
        }));
    }
}
