<?php
namespace App\Services\Actions;

use App\Services\{NodeDnsLifecycle,ProxyService};
use Illuminate\Support\Facades\DB;

final class UpdateManualNodeAddress {
    public static function resource(string $type,$node): array {
        $binding=DB::table('v2_node_ddns')->where('node_type',$type)->where('node_id',$node->id)->first();
        $managed=$binding && $binding->status!=='manual';
        return ['values'=>$node->only(['host','port']),'managed'=>$managed,'serverName'=>$node->tls_settings['server_name']??null,
            'revision'=>hash('sha256',json_encode([$node->only(['host','port','server_port','listen_ip','protocol','network','network_settings','tls','tls_settings','service_id']),$managed]))];
    }
    public static function run(string $type,int $id,string $revision,array $values): array {
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($type,$id,$revision,$values){
            $node=ProxyService::model($type)::whereKey($id)->lockForUpdate()->first();
            abort_unless($node && !$node->service_id,422,'复用线路请通过线路编辑与发布修改连接地址');
            $state=self::resource($type,$node);
            abort_if($state['managed'],409,'此节点已绑定域名，请通过域名设置和验证流程修改连接地址');
            abort_unless(hash_equals($state['revision'],$revision),409,'连接或证书配置已变化，请重新载入后保存');
            $node->fill(\Illuminate\Support\Arr::only($values,['host','port']));$node->save();
            return self::resource($type,$node->fresh());
        }));
    }
}
