<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Administrative preflight only. A listener belongs to a physical server. */
final class NodeListenerGuard {
    private static function transports(string $protocol): array {
        return in_array($protocol,['tuic','hysteria2'],true) ? ['udp'] : ($protocol==='shadowsocks' ? ['tcp','udp'] : ['tcp']);
    }
    public static function check(string $type,$node,?int $server=null): void {
        if ($node->service_id) return;
        $server ??= DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$node->id)->value('server_id');
        if (!$server) return; // An unmanaged address is not evidence of physical ownership.
        $protocols=self::transports($node->protocol);
        $address=$node->listen_ip ?: '0.0.0.0';
        foreach (['v2box'] as $backend) {
            $ids=DB::table('v2_node_ddns')->where('server_id',$server)->where('node_type',$backend)->pluck('node_id');
            $query=ProxyService::model($backend)::whereIn('id',$ids)->whereNull('service_id')->where('server_port',$node->server_port);
            if ($backend===$type) $query->where('id','!=',$node->id);
            foreach ($query->get(['id','protocol','listen_ip']) as $other) {
                $otherAddress=$other->listen_ip ?: '0.0.0.0';
                $overlaps=$address===$otherAddress || in_array($address,['0.0.0.0','::'],true) || in_array($otherAddress,['0.0.0.0','::'],true);
                abort_if($overlaps && array_intersect($protocols,self::transports($other->protocol)),422,'监听端口已被同服务器的代理服务占用，请调整端口或监听地址');
            }
        }
        $entries=DB::table('v2_node_ddns')->where('server_id',$server)->where('purpose','entry')->pluck('id');
        // Ingress reservations are conservative because their actual listener address is external.
        abort_if(DB::table('v2_node_ddns')->whereIn('entry_id',$entries)->where('entry_port',$node->server_port)->exists() ||
            DB::table('v2_node_connection')->where(function($q)use($entries,$node){
                $q->where(fn($q)=>$q->whereIn('entry_id',$entries)->where('entry_port',$node->server_port))
                    ->orWhere(fn($q)=>$q->whereIn('published->entry_id',$entries)->where('published->port',$node->server_port));
            })->exists(),422,'监听端口已被本服务器的入口转发占用');
    }
}
