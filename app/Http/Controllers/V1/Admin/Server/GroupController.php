<?php

namespace App\Http\Controllers\V1\Admin\Server;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\ServerGroup;
use App\Models\User;
use App\Models\ServerV2node;
use App\Models\ServerV2box;
use Illuminate\Http\Request;

class GroupController extends Controller
{
    public function fetch(Request $request)
    {
        $request->validate(['group_id'=>'nullable|integer|min:1']);
        if ($request->filled('group_id')) {
            return response([
                'data' => [ServerGroup::findOrFail($request->input('group_id'))]
            ]);
        }
        $serverGroups = ServerGroup::get();
        $users = User::select('group_id')->selectRaw('COUNT(*) AS total')->groupBy('group_id')->pluck('total', 'group_id');
        $counts = [];
        foreach ([ServerV2node::class, ServerV2box::class] as $model) {
            foreach ($model::select('group_id')->get() as $node) {
                foreach (array_unique((array)$node->group_id) as $id) $counts[$id] = ($counts[$id] ?? 0) + 1;
            }
        }
        foreach ($serverGroups as $group) {
            $group['user_count'] = (int)$users->get($group->id, 0);
            $group['server_count'] = $counts[$group->id] ?? 0;
        }
        return response([
            'data' => $serverGroups
        ]);
    }

    public function save(Request $request)
    {
        $data = $request->validate(['id'=>'nullable|integer|min:1', 'name'=>'required|string|max:255']);
        $serverGroup = !empty($data['id']) ? ServerGroup::findOrFail($data['id']) : new ServerGroup();
        $serverGroup->name = $data['name'];
        return response([
            'data' => $serverGroup->save()
        ]);
    }

    public function drop(Request $request)
    {
        $request->validate(['id'=>'required|integer|min:1']);
        $serverGroup = ServerGroup::findOrFail($request->input('id'));
        if ((int)$serverGroup->id === \App\Services\TrafficCreditService::baseGroupId()) abort(422, '该组被设为额度基础权限组，请先更换配置');
        foreach ([ServerV2node::class, ServerV2box::class] as $model) {
            foreach ($model::select('group_id')->cursor() as $node) {
                if (in_array($serverGroup->id, (array)$node->group_id)) abort(422, '该组已被节点所使用，无法删除');
            }
        }

        if (Plan::where('group_id', $serverGroup->id)->exists()) {
            abort(500, '该组已被订阅所使用，无法删除');
        }
        if (User::where('group_id', $serverGroup->id)->exists()) {
            abort(500, '该组已被用户所使用，无法删除');
        }
        return response([
            'data' => $serverGroup->delete()
        ]);
    }
}
