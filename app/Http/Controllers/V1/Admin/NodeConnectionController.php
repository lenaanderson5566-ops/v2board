<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Services\{NodeConnection,NodeDnsLifecycle,NodeRuntimeService,ProxyService};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class NodeConnectionController extends Controller {
    public function defaultLine(Request $request) {
        $v=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1']);
        $node=ProxyService::model($v['type'])::find($v['id']);
        abort_unless($node && !$node->service_id,422,'请选择独立代理服务的默认线路');
        return ['data'=>\App\Services\Actions\UpdateDefaultNodeLine::resource($node)];
    }
    public function updateDefaultLine(Request $request) {
        $allowed=array_merge(['type','id','revision'],\App\Services\Actions\UpdateDefaultNodeLine::FIELDS);
        abort_if(array_diff(array_keys($request->except('user')),$allowed),422,'默认线路仅允许修改名称、权限、倍率和展示信息');
        $request->merge(\App\Services\NodeDisplayService::normalizeInput($request->all()));
        $v=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1','revision'=>'required|string|size:64',
            'name'=>'required|string|max:100','group_id'=>'present|array|max:100','group_id.*'=>'integer|min:1|distinct',
            'rate'=>'required|numeric|min:0|max:10000','region_code'=>'nullable|string|size:2|in:'.implode(',',\App\Services\NodeDisplayService::regionCodes()),
            'city_code'=>'nullable|string|max:64|regex:/^[a-z0-9][a-z0-9-]*$/','display_label'=>'nullable|string|max:64','tags'=>'nullable|array|max:20','tags.*'=>'string|max:64']);
        return ['data'=>\App\Services\Actions\UpdateDefaultNodeLine::run($v['type'],(int)$v['id'],$v['revision'],$v)];
    }
    public function fetch(Request $request) {
        $v=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1']);
        $line=ProxyService::model($v['type'])::find($v['id']); abort_unless($line,404);
        $row=DB::table('v2_node_connection')->where('node_type',$v['type'])->where('node_id',$line->id)->first();
        $draft=$row ? json_decode($row->draft,true) : ['service_id'=>$line->service_id?:$line->id,'entry_id'=>null,'entry_port'=>443,'name'=>$line->name,'group_id'=>$line->group_id,'show'=>(int)$line->show];
        $plan=null; $error=null;
        try { $plan=NodeConnection::plan($v['type'],$draft); } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) { $error=$e->getMessage(); }
        $draft+=\Illuminate\Support\Arr::only($line->toArray(),['region_code','city_code','display_label','tags']);
        return ['data'=>['id'=>$row->id??null,'revision'=>$row->revision??0,'draft'=>$draft,'plan'=>$plan,'error'=>$error,
            'published'=>$row && $row->published ? json_decode($row->published,true):null,'verified_at'=>$row->verified_at??0,
            'current'=>['host'=>$line->host,'port'=>$line->port]]];
    }
    public function save(Request $request) {
        $request->merge(\App\Services\NodeDisplayService::normalizeInput($request->all()));
        $v=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'nullable|integer|min:1','revision'=>'required|integer|min:0',
            'service_id'=>'required|integer|min:1','entry_id'=>'nullable|integer|min:1','entry_port'=>'nullable|integer|between:1,65535',
            'name'=>'required|string|max:100','group_id'=>'required|array|min:1|max:100','group_id.*'=>'integer|min:1|distinct','show'=>'required|boolean',
            'region_code'=>'nullable|string|size:2|in:'.implode(',',\App\Services\NodeDisplayService::regionCodes()),
            'city_code'=>'nullable|string|max:64|regex:/^[a-z0-9][a-z0-9-]*$/',
            'display_label'=>'nullable|string|max:64','tags'=>'nullable|array|max:20','tags.*'=>'string|max:64']);
        return NodeDnsLifecycle::locked(fn()=>DB::transaction(function()use($v){
            $draft=array_intersect_key($v,array_flip(['service_id','entry_id','entry_port','name','group_id','show','region_code','city_code','display_label','tags']));
            $plan=NodeConnection::plan($v['type'],$draft);
            $model=ProxyService::model($v['type']); $service=$model::findOrFail($v['service_id']);
            $line=isset($v['id'])?$model::find($v['id']):null;
            abort_if(isset($v['id']) && (!$line || !$line->service_id),422,'代理服务的默认线路请在部署与接入中管理；可新增关联线路');
            $old=$line?DB::table('v2_node_connection')->where('node_type',$v['type'])->where('node_id',$line->id)->first():null;
            abort_unless((int)($old->revision??0)===$v['revision'],409,'线路已被其他管理员修改，请重新载入');
            NodeConnection::assertPort($plan,$old->id??0);
            abort_if(!$old && DB::table('v2_node_connection')->count()>=2000,422,'接入线路数量已达上限');
            if (!$line) {
                $line=$service->replicate(); $line->name=$v['name']; $line->service_id=$service->id;
                // Client identity is resolved from the service. Do not duplicate private material.
                $line->tls_settings=null; $line->encryption_settings=null; $line->network_settings=null; $line->route_id=null;
                if ($v['type']==='v2box') $line->sing_box=null;
                $line->show=0; $line->group_id=$v['group_id']; $line->save();
            }
            $data=['draft'=>json_encode($draft),'entry_id'=>$plan['entry_id'],'entry_port'=>$plan['entry_id']?$plan['port']:null,'revision'=>($old->revision??0)+1];
            if ($old) DB::table('v2_node_connection')->where('id',$old->id)->update($data);
            else DB::table('v2_node_connection')->insert($data+['node_type'=>$v['type'],'node_id'=>$line->id]);
            return ['data'=>['id'=>$line->id]];
        }));
    }
    public function publish(Request $request) {
        $v=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1','revision'=>'required|integer|min:1','proof'=>'required|string|size:64','confirmed'=>'required|accepted']);
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
