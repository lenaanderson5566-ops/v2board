<?php
namespace App\Http\Controllers\V1\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\ServerV2node;
use App\Models\ServerV2box;
use App\Services\ServerService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ManageController extends Controller
{
    public function getNodes(Request $request)
    {
        return response(['data' => (new ServerService())->getAllServers()]);
    }

    public function runtime(Request $request)
    {
        $input = $request->validate(['type' => 'required|in:v2node,v2box', 'id' => 'required|integer|min:1']);
        $node = (new ServerService())->getServer($input['id'], $input['type']);
        abort_unless($node, 404, '节点不存在');
        return response(['data' => \App\Services\NodeRuntimeService::inspect($input['type'], $node)]);
    }

    public function maintenance(Request $request)
    {
        $input=$request->validate(['type'=>'required|in:v2node,v2box','id'=>'required|integer|min:1',
            'enabled'=>'required|boolean','reason'=>'required_if:enabled,true|string|max:200',
            'endsAt'=>'required_if:enabled,true|integer|min:1','hideSubscription'=>'required|boolean']);
        DB::transaction(function () use ($input) {
            $model=$input['type']==='v2box' ? ServerV2box::class : ServerV2node::class;
            abort_unless($model::whereKey($input['id'])->lockForUpdate()->first(),404,'节点不存在');
            \App\Services\NodeMaintenance::save($input['type'],$input['id'],$input);
        });
        return response(['data'=>true]);
    }

    public function sort(Request $request)
    {
        $models = ['v2node' => ServerV2node::class, 'v2box' => ServerV2box::class];
        abort_unless(!array_diff(array_keys($request->except(['user', 'auth_data', '_token'])), array_keys($models)), 422, '不支持的节点类型');
        $params = $request->validate([
            'v2node' => 'sometimes|array',
            'v2node.*' => 'integer|min:0',
            'v2box' => 'sometimes|array',
            'v2box.*' => 'integer|min:0',
        ]);
        DB::transaction(function () use ($params, $models) {
            foreach ($params as $type => $items) {
                foreach ($items as $id => $sort) {
                    $server = $models[$type]::find($id);
                    abort_unless($server, 422, '节点不存在');
                    $server->update(['sort' => $sort]);
                }
            }
        });
        return response(['data' => true]);
    }
}
