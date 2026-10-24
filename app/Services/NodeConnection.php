<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Administrative connection planning. No DNS or network calls on subscription paths. */
final class NodeConnection {
    public static function referencesEntry(int $id): bool {
        return DB::table('v2_node_connection')->where('entry_id',$id)->orWhere('published->entry_id',$id)->exists();
    }
    public static function inUse(string $domain): bool {
        return DB::table('v2_node_connection')->where('published->origin_domain',$domain)->orWhere('published->entry_domain',$domain)->exists();
    }
    /** Keep the currently configured endpoint when an existing line first gains a draft. */
    public static function currentEndpoint(string $type,$line): array {
        $service=ProxyService::model($type)::find($line->service_id);
        $origin=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$line->service_id)->first();
        $entry=$origin?->entry_id ? DB::table('v2_node_ddns')->find($origin->entry_id) : null;
        if($entry && ($entry->domain!==$line->host || (int)$origin->entry_port!==(int)$line->port))$entry=null;
        return ['host'=>$line->host,'port'=>$line->port,'service_id'=>$line->service_id,
            'origin_domain'=>$origin->domain??$service?->host,'origin_port'=>$service?->server_port,'origin_server_id'=>$origin?->server_id,
            'entry_id'=>$entry?->id,'entry_server_id'=>$entry?->server_id];
    }
    public static function plan(string $type,array $draft): array {
        $service=ProxyService::model($type)::find($draft['service_id']);
        abort_unless($service && !$service->service_id,422,'代理服务不存在或不是独立服务');
        $origin=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$service->id)->first();
        abort_unless($origin && $origin->purpose==='node' && $origin->server_id,422,'请先为代理服务配置服务器与回源域名');
        abort_unless($origin->enabled && $origin->managed && $origin->status!=='manual',422,'请先启用原节点的自动域名管理，再新增或发布复用线路');
        $entry=empty($draft['entry_id']) ? null : DB::table('v2_node_ddns')->find($draft['entry_id']);
        abort_if(!empty($draft['entry_id']) && (!$entry || $entry->purpose!=='entry' || !$entry->enabled),422,'请选择有效的入口域名');
        abort_if($entry && $entry->server_id===$origin->server_id,422,'入口和代理服务不能使用同一台服务器');
        $tls=(array)$service->tls_settings;
        if ((int)$service->tls===1) abort_unless(!empty($tls['server_name']) && !$service->disable_sni,422,'请先为代理服务设置独立的 TLS 身份域名并启用 SNI');
        if ($entry && (int)$service->tls===1) {
            abort_unless(in_array($tls['cert_mode']??'',['http','dns','file','remote'],true),422,'中转线路需要 HTTP、DNS 验证或已有证书');
        }
        $port=(int)($entry ? ($draft['entry_port']??0) : $service->server_port);
        abort_unless($port>=1 && $port<=65535,422,'端口必须为 1–65535');
        $line=(object)['id'=>0,'group_id'=>$draft['group_id']];
        ProxyService::validate($line,$service);
        $plan=['service_id'=>$service->id,'entry_id'=>$entry->id??null,'entry_server_id'=>$entry->server_id??null,
            'origin_id'=>$origin->id,'origin_server_id'=>$origin->server_id,'origin_domain'=>$origin->domain,
            'origin_port'=>(int)$service->server_port,'origin_family'=>$origin->family,
            'entry_domain'=>$entry->domain??null,'entry_family'=>$entry->family??null,
            'host'=>$entry->domain??$origin->domain,'port'=>$port,'protocol'=>$service->protocol,
            'tls'=>(int)$service->tls,'server_name'=>$tls['server_name']??null];
        // Includes private service configuration only in a one-way proof, never in responses.
        $plan['proof']=hash('sha256',json_encode([$draft,$plan,ProxyService::overlay([],$service->toArray()),
            $service->group_id,$origin->enabled,$origin->tls_transition_state,
            NetworkServer::addresses($origin),$entry?NetworkServer::addresses($entry):null]));
        $plan['dns_ready']=NetworkServer::ready($origin) && (!$entry || NetworkServer::ready($entry));
        $plan['transition_pending']=$origin->tls_transition_state==='pending';
        return $plan;
    }
    public static function assertPort(array $plan,int $except=0,string $type='v2box',int $nodeId=0): void {
        if (!$plan['entry_id']) return;
        $entries=DB::table('v2_node_ddns')->where('server_id',$plan['entry_server_id'])->where('purpose','entry')->pluck('id');
        // Reserve the whole port conservatively; no implicit TCP/UDP or SNI sharing.
        abort_if(DB::table('v2_node_ddns')->whereIn('entry_id',$entries)->where('entry_port',$plan['port'])->exists(),409,'入口服务器端口已被现有线路占用');
        $rows=DB::table('v2_node_connection')->where('id','!=',$except)->where(function($q)use($entries){
            $q->whereIn('entry_id',$entries)->orWhereIn('published->entry_id',$entries);
        })->get(['entry_id','entry_port','published']);
        foreach($rows as $row) {
            $published=json_decode($row->published??'null',true);
            abort_if(($entries->contains($row->entry_id) && (int)$row->entry_port===$plan['port']) ||
                ($published && (int)$published['entry_server_id']===$plan['entry_server_id'] && (int)$published['port']===$plan['port']),409,'入口服务器端口已被其他线路或待发布配置占用');
        }
    }
}
