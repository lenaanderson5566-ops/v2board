<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Service-owned fields have one source of truth, independent of published endpoints. */
final class ProxyService {
    public const FIELDS = ['protocol','listen_ip','server_port','network','network_settings',
        'trusted_x_forwarded_for','tls','tls_settings','encryption','encryption_settings','flow',
        'cipher','congestion_control','zero_rtt_handshake','up_mbps','down_mbps','obfs',
        'obfs_password','padding_scheme','server_key','ignore_client_bandwidth','route_id',
        'sing_box','disable_sni','udp_relay_mode','rate','created_at'];

    public static function model(string $type): string {
        abort_unless(in_array($type,['v2node','v2box'],true),422);
        return $type==='v2box' ? \App\Models\ServerV2box::class : \App\Models\ServerV2node::class;
    }
    public static function overlay(array $line,array $service): array {
        foreach(self::FIELDS as $key) if (array_key_exists($key,$service)) $line[$key]=$service[$key];
        if (isset($line['updated_at'],$service['updated_at'])) $line['updated_at']=max($line['updated_at'],$service['updated_at']);
        return $line;
    }
    public static function validate($line,$service): void {
        abort_unless($service && !$service->service_id && (int)$line->id!==(int)$service->id,422,'请选择独立的代理服务，不能关联线路或自身');
        abort_if(array_diff((array)$line->group_id,(array)$service->group_id),422,'线路权限必须在代理服务允许的权限组内');
    }
    public static function assertUnused(string $type,int $id): void {
        abort_if(self::model($type)::where('service_id',$id)->exists() || DB::table('v2_node_connection')->where('node_type',$type)->where('draft->service_id',$id)->exists(),409,'代理服务仍有关联线路或待发布配置，请先迁移或删除线路');
    }
    public static function removeConnection(string $type,int $id): void {
        DB::table('v2_node_connection')->where('node_type',$type)->where('node_id',$id)->delete();
    }
}
