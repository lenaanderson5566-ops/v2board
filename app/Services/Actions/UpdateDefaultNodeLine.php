<?php
namespace App\Services\Actions;

use App\Services\{NodeDnsLifecycle,ProxyService};
use Illuminate\Support\Facades\DB;

final class UpdateDefaultNodeLine {
    public const FIELDS=['name','group_id','rate','region_code','city_code','display_label','tags'];
    public const PRESERVED_FIELDS=['name','group_id','rate','region_code','city_code','display_label','tags','show','sort','host','port'];
    public static function resource($node): array {
        $values=$node->only(self::FIELDS);
        return ['values'=>$values,'revision'=>hash('sha256',json_encode($values)),
            'sharedLines'=>ProxyService::model($node->getTable()==='v2_server_v2box'?'v2box':'v2node')::where('service_id',$node->id)->count()];
    }
    public static function run(string $type,int $id,string $revision,array $values): array {
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($type,$id,$revision,$values){
            $model=ProxyService::model($type);$node=$model::whereKey($id)->lockForUpdate()->first();
            abort_unless($node && !$node->service_id,422,'请选择独立代理服务的默认线路');
            $current=self::resource($node);
            abort_unless(hash_equals($current['revision'],$revision),409,'默认线路已被其他管理员修改，请重新载入后保存');
            foreach($model::where('service_id',$id)->get(['group_id']) as $line)
                abort_if(array_diff((array)$line->group_id,$values['group_id']),409,'此权限组仍被关联线路使用，请先调整关联线路权限');
            foreach(DB::table('v2_node_connection')->where('node_type',$type)->where('draft->service_id',$id)->get(['draft']) as $line){
                $draft=json_decode($line->draft,true);
                abort_if(array_diff($draft['group_id']??[],$values['group_id']),409,'此权限组仍被待发布线路使用，请先调整待发布配置');
            }
            $node->fill(array_intersect_key($values,array_flip(self::FIELDS)));$node->save();
            return self::resource($node->fresh());
        }));
    }
}
