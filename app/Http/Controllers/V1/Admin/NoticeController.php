<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\NoticeSave;
use App\Models\Notice;
use Illuminate\Http\Request;

class NoticeController extends Controller
{
    public function fetch(Request $request)
    {
        return response([
            'data' => Notice::orderBy('id', 'DESC')->get()
        ]);
    }

    public function save(NoticeSave $request)
    {
        $data = $request->only([
            'title',
            'content',
            'img_url',
            'tags',
            'translations',
            'source_language'
        ]);
        if (!$request->input('id')) {
            if (!Notice::create($data)) {
                abort(500, '保存失败');
            }
        } else {
            Notice::findOrFail($request->input('id'))->update($data);
        }
        return response([
            'data' => true
        ]);
    }



    public function show(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1']);
        $notice = Notice::findOrFail($params['id']);
        $notice->show = $notice->show ? 0 : 1;
        if (!$notice->save()) {
            abort(500, '保存失败');
        }

        return response([
            'data' => true
        ]);
    }

    public function drop(Request $request)
    {
        $params = $request->validate(['id' => 'required|integer|min:1']);
        $notice = Notice::findOrFail($params['id']);
        if (!$notice->delete()) {
            abort(500, '删除失败');
        }
        return response([
            'data' => true
        ]);
    }
}
