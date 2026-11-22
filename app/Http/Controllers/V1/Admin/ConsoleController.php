<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\V2boxSaveRules;
use Illuminate\Http\Request;

class ConsoleController extends Controller
{
    public function configSchema()
    {
        return response(['data' => \App\Http\Requests\Admin\ConfigSave::allRules()]);
    }
    public function nodeSchema(Request $request)
    {
        $type = $request->input('type');
        abort_unless($type === 'v2box', 422, '不支持的节点类型');
        return response(['data' => V2boxSaveRules::formRules()]);
    }
}
