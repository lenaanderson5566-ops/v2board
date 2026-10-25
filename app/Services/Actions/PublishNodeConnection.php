<?php
namespace App\Services\Actions;
use App\Services\{NodeConnection,NodeDnsLifecycle,NodeRuntimeService,ProxyService};
use Illuminate\Support\Facades\DB;
final class PublishNodeConnection {
    public static function run(array $v): array {
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $row=DB::table('v2_node_connection')->where('node_type',$v['type'])->where('node_id',$v['id'])->lockForUpdate()->first();
            abort_unless($row && $row->revision===$v['revision'],409,'线路已变化，请重新载入');
            $draft=json_decode($row->draft,true); $plan=NodeConnection::plan($v['type'],$draft);
            abort_unless(hash_equals($plan['proof'],$v['proof']) && $plan['dns_ready'] && !$plan['transition_pending'],409,'配置或解析状态已变化，请重新检查后发布');
            NodeConnection::assertPort($plan,$row->id);
            $model=ProxyService::model($v['type']); $service=$model::findOrFail($draft['service_id']);
            $runtime=NodeRuntimeService::inspect($v['type'],$service);
            $applied=$runtime['applicationState']==='applied' || ($v['type']==='v2node' && $runtime['configurationState']==='provided');
            abort_unless($runtime['runtimeStatus']==='online' && $applied && !$runtime['maintenance'],409,'请先完成代理服务的配置应用与运行验证');
            $line=$model::findOrFail($row->node_id);
            abort_unless($line->service_id,409,'线路已转换为代理服务');
            $line->fill(\Illuminate\Support\Arr::only($draft,['region_code','city_code','display_label','tags'])+['name'=>$draft['name'],'group_id'=>$draft['group_id'],'show'=>$draft['show'],
                'service_id'=>$service->id,'host'=>$plan['host'],'port'=>$plan['port']]); $line->save();
            DB::table('v2_node_connection')->where('id',$row->id)->update(['published'=>json_encode($plan),'verified_at'=>time(),'revision'=>$row->revision+1]);
            return ['data'=>true];
        }));
    }
}
