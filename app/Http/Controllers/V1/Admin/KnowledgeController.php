<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\KnowledgeSave;
use App\Http\Requests\Admin\KnowledgeSort;
use App\Models\Knowledge;
use Illuminate\Http\Request;

class KnowledgeController extends Controller
{
    public function fetch(Request $request)
    {
        $params = $request->validate(['id' => 'nullable|integer|min:1']);
        if (isset($params['id'])) {
            $knowledge = Knowledge::findOrFail($params['id']);
            return response([
                'data' => $knowledge
            ]);
        }
        return response([
            'data' => Knowledge::select(['title', 'id', 'updated_at', 'category', 'show', 'language', 'sort'])
                ->orderBy('sort', 'ASC')
                ->get()
        ]);
    }

    public function getCategory(Request $request)
    {
        return response([
            'data' => Knowledge::query()->distinct()->pluck('category')->all()
        ]);
    }

    public function save(KnowledgeSave $request)
    {
        $params = $request->validated();
        $id = $params['id'] ?? null;
        unset($params['id']);

        if ($id === null) {
            if (!Knowledge::create($params)) {
                abort(500, '创建失败');
            }
        } else {
            Knowledge::findOrFail($id)->update($params);
        }

        return response([
            'data' => true
        ]);
    }

    public function show(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1']);
        $knowledge = Knowledge::findOrFail($params['id']);
        $knowledge->show = $knowledge->show ? 0 : 1;
        if (!$knowledge->save()) {
            abort(500, '保存失败');
        }

        return response([
            'data' => true
        ]);
    }

    public function sort(KnowledgeSort $request)
    {
        \App\Services\AdminSortOrder::apply(Knowledge::class, $request->input('knowledge_ids'), false);
        return response([
            'data' => true
        ]);
    }

    public function drop(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1']);
        $knowledge = Knowledge::findOrFail($params['id']);
        if (!$knowledge->delete()) {
            abort(500, '删除失败');
        }

        return response([
            'data' => true
        ]);
    }
}
