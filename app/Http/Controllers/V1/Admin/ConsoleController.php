<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
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
        abort_unless(in_array($type, ['v2node', 'v2box'], true), 422, '不支持的节点类型');
        $source = file_get_contents(app_path('Http/Controllers/V1/Admin/Server/V2nodeController.php'));
        preg_match('/\$request->validate\(\[(.*?)\]\s*[,)]/s', $source, $block);
        preg_match_all("/'([^']+)'\\s*=>\\s*'([^']*)'/", $block[1] ?? '', $matches, PREG_SET_ORDER);
        $rules = [];
        foreach ($matches as $match) $rules[$match[1]] = $match[2];
        $rules['protocol'] = 'required|in:shadowsocks,vmess,vless,trojan,tuic,hysteria2,anytls';
        if ($type === 'v2box') $rules = array_merge($rules, array_filter(\App\Http\Controllers\V1\Admin\Server\V2boxController::RULES, fn ($key) => strpos($key, '.') === false, ARRAY_FILTER_USE_KEY));
        if (isset($rules['group_id']) && strpos($rules['group_id'], 'array') === false) $rules['group_id'] .= '|array';
        return response(['data' => $rules]);
    }
}
