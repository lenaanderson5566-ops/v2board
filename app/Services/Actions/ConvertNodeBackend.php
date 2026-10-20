<?php
namespace App\Services\Actions;

use App\Models\ServerV2node;
use App\Models\ServerV2box;
use Illuminate\Support\Facades\DB;

class ConvertNodeBackend {
    public static function run(string $sourceType, int $id, string $targetType, array $params) {
        $models = ['v2node'=>ServerV2node::class, 'v2box'=>ServerV2box::class];
        abort_unless(isset($models[$sourceType], $models[$targetType]) && $sourceType !== $targetType, 422, '请选择不同的目标节点类型');
        return DB::transaction(function () use ($models, $sourceType, $targetType, $id, $params) {
            $source = $models[$sourceType]::whereKey($id)->lockForUpdate()->firstOrFail();
            abort_if($models[$sourceType]::where('parent_id', $id)->exists(), 422, '此节点仍有子节点，请先解除子节点的父节点关联再切换类型');
            // Node IDs belong to separate tables. Always allocate a new target identity;
            // never update an unrelated target node with the same numeric ID.
            $target = new $models[$targetType]();
            $target->fill(array_merge($source->only(['show','sort','tags','region_code','city_code','display_label']), $params));
            $target->route_id = $params['route_id'] ?? [];
            $target->parent_id = $params['parent_id'] ?? null;
            if ($target->parent_id) {
                abort_if(DB::table('v2_server_traffic_binding')->where('node_type',$sourceType)->where('node_id',$id)->exists(),422,'请先解除服务器额度绑定，再设置为子节点');
                $parent = $models[$targetType]::find($target->parent_id);
                abort_unless($parent && $parent->protocol === $target->protocol, 422, '请选择目标类型下同协议的父节点');
            }
            // Shadowsocks 2022 derives its server key from created_at.
            $target->created_at = $source->created_at;
            $target->save();
            DB::table('v2_node_ddns')->where('node_type',$sourceType)->where('node_id',$id)->update(['node_type'=>$targetType,'node_id'=>$target->id]);
            foreach (['v2_server_traffic_binding','v2_server_traffic_import'] as $table) {
                DB::table($table)->where('node_type',$sourceType)->where('node_id',$id)->update(['node_type'=>$targetType,'node_id'=>$target->id]);
            }
            $cloud=DB::table('v2_lightsail_server')->where('node_type',$sourceType)->where('node_id',$id)->lockForUpdate()->first();
            if($cloud){
                abort_unless(in_array($cloud->status,['ready','completed','restored'],true),409,'请先完成 Lightsail IP 操作再切换节点类型');
                abort_if($target->parent_id,422,'Lightsail 配置只支持主节点');
                DB::table('v2_lightsail_server')->where('id',$cloud->id)->update(['node_type'=>$targetType,'node_id'=>$target->id]);
            }
            \App\Services\NodeCredentials::retire($sourceType,(int)$source->id);
            // A converted migrated node must not silently regain global-key access.
            if (\App\Services\NodeCredentials::migrated($sourceType,(int)$source->id))
                DB::table('v2_node_credential_state')->insert(['node_type'=>$targetType,'node_id'=>$target->id,'migrated_at'=>time()]);
            $source->delete();
            return $target;
        });
    }
}
