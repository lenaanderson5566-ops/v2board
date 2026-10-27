<?php
namespace App\Http\Controllers\V1\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\ServerRoute;
use App\Models\ServerV2box;
use App\Services\NodeRouteService;
use App\Services\V2boxFeatures;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RouteController extends Controller {
    public function fetch(Request $request) {
        $request->validate(['backend'=>'nullable|in:v2box']);
        $query = ServerRoute::where('backend', 'v2box')->orderBy('id');
        $routes = $query->get();
        foreach ($routes as $route) $route->match = json_decode($route->match, true) ?? [];
        return ['data'=>$routes];
    }
    public function save(Request $request) {
        $route = $request->input('id') ? ServerRoute::findOrFail($request->input('id')) : new ServerRoute();
        $backend = $request->input('backend', $route->backend ?? 'v2box');
        $request->merge(['backend'=>$backend]);
        $params = $request->validate([
            'backend'=>'required|in:v2box', 'remarks'=>'required|string|max:255',
            'action'=>'required|in:block,block_ip,block_port,protocol,dns,route,route_ip,default_out,sing_box',
        ]);
        abort_if($route->exists && $route->backend !== $backend, 422, '已保存规则不能更换内核，请新建对应内核的规则');
        if ($params['action'] === 'sing_box') {
            $params += $request->validate(['sing_box'=>'required|array:dns,route,outbounds']);
            V2boxFeatures::validate($params['sing_box']);
            $params += ['match'=>'[]', 'action_value'=>null];
        } else {
            $params += $request->validate(['match'=>'array|required_unless:action,default_out', 'match.*'=>'string', 'action_value'=>'nullable|string']);
            $params['match'] = json_encode($params['action'] === 'default_out' ? [] : array_values(array_filter($params['match'] ?? [])));
            $params['sing_box'] = null;
        }
        DB::transaction(function () use ($route, $params) {
            $route->fill($params)->save();
            // Reject edits that would invalidate another rule selected on an existing node.
            foreach (ServerV2box::cursor() as $node) {
                if (in_array($route->id, $node->route_id ?? [])) NodeRouteService::forNode($node);
            }
        });
        return ['data'=>true];
    }
    public function drop(Request $request) {
        $route = ServerRoute::findOrFail($request->input('id'));
        $model = ServerV2box::class;
        foreach ($model::cursor() as $node) {
            abort_if(in_array($route->id, $node->route_id ?? []), 422, '规则正在被节点使用，请先取消节点的规则选择');
        }
        $route->delete();
        return ['data'=>true];
    }
}
