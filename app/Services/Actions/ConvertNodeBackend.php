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
                $parent = $models[$targetType]::find($target->parent_id);
                abort_unless($parent && $parent->protocol === $target->protocol, 422, '请选择目标类型下同协议的父节点');
            }
            // Shadowsocks 2022 derives its server key from created_at.
            $target->created_at = $source->created_at;
            $target->save();
            DB::table('v2_node_ddns')->where('node_type',$sourceType)->where('node_id',$id)->update(['node_type'=>$targetType,'node_id'=>$target->id]);
            $source->delete();
            return $target;
        });
    }
}
