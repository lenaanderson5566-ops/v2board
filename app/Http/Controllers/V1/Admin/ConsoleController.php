<?php
namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class ConsoleController extends Controller
{
    public function nodeSchema(Request $request)
    {
        $classes = ['vmess' => 'ServerVmessSave', 'trojan' => 'ServerTrojanSave', 'shadowsocks' => 'ServerShadowsocksSave'];
        $controllers = ['v2node' => 'V2node', 'vless' => 'Vless', 'hysteria' => 'Hysteria', 'tuic' => 'Tuic', 'anytls' => 'AnyTLS'];
        $type = $request->input('type');
        if (isset($classes[$type])) {
            $class = 'App\\Http\\Requests\\Admin\\' . $classes[$type];
            $rules = (new $class())->rules();
        } else {
            abort_unless(isset($controllers[$type]), 422, '不支持的节点类型');
            $source = file_get_contents(app_path('Http/Controllers/V1/Admin/Server/' . $controllers[$type] . 'Controller.php'));
            preg_match('/\$request->validate\(\[(.*?)\]\s*[,)]/s', $source, $block);
            preg_match_all("/'([^']+)'\\s*=>\\s*'([^']*)'/", $block[1] ?? '', $matches, PREG_SET_ORDER);
            $rules = [];
            foreach ($matches as $match) $rules[$match[1]] = $match[2];
        }
        if (isset($rules['group_id']) && strpos($rules['group_id'], 'array') === false) $rules['group_id'] .= '|array';
        return response(['data' => $rules]);
    }
}
