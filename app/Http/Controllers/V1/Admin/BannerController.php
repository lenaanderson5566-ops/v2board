<?php
namespace App\Http\Controllers\V1\Admin;
use App\Http\Controllers\Controller;
use App\Models\Banner;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
class BannerController extends Controller
{
    public function fetch() { return response(['data'=>Banner::orderBy('sort')->orderByDesc('id')->get()]); }
    private function urlRule()
    {
        return function ($attribute, $value, $fail) {
            $decoded = rawurldecode($value);
            $relative = preg_match('~^/(?!/)~', $decoded);
            $parts = parse_url($value);
            $external = $parts && in_array(strtolower($parts['scheme'] ?? ''), ['https', 'http'], true)
                && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass']);
            if ((!$relative && !$external) || preg_match('/[\\x00-\\x20\\x7f\\\\]/', $decoded)) {
                $fail('图片与跳转地址仅支持 HTTP(S) 或以 / 开头的站内路径');
            }
        };
    }
    public function save(Request $request)
    {
        $url = ['nullable', 'string', 'max:2048', $this->urlRule()];
        $data = $request->validate([
            'id'=>'sometimes|nullable|integer|min:1', 'title'=>'required|string|max:200',
            'image_url'=>array_merge(['required'], array_slice($url, 1)),
            'mobile_image_url'=>$url, 'target_url'=>$url,
            'placements'=>'required|array|min:1|max:2', 'placements.*'=>'required|distinct|in:landing,dashboard',
            'languages'=>'nullable|array|max:8', 'languages.*'=>'required|distinct|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'show'=>'required|boolean', 'sort'=>'required|integer|min:0|max:100000',
            'starts_at'=>'nullable|integer|min:0|max:4294967295', 'ends_at'=>'nullable|integer|min:0|max:4294967295',
        ]);
        if (!empty($data['starts_at']) && !empty($data['ends_at']) && $data['ends_at'] <= $data['starts_at']) {
            throw ValidationException::withMessages(['ends_at'=>'下线时间必须晚于上线时间']);
        }
        $banner = !empty($data['id']) ? Banner::findOrFail($data['id']) : new Banner;
        unset($data['id']);
        $banner->fill($data)->save();
        return response(['data'=>$banner]);
    }
    public function show(Request $request)
    {
        $data=$request->validate(['id'=>'required|integer|min:1', 'show'=>'required|boolean']);
        $banner=Banner::findOrFail($data['id']); $banner->show=$data['show']; $banner->save();
        return response(['data'=>true]);
    }
    public function drop(Request $request)
    {
        $data=$request->validate(['id'=>'required|integer|min:1']);
        Banner::findOrFail($data['id'])->delete();
        // Keep uploaded files: another banner may reference the same image.
        return response(['data'=>true]);
    }
    public function upload(Request $request)
    {
        $request->validate(['image'=>'required|file|image|mimes:jpg,jpeg,png,webp|max:5120|dimensions:max_width=6000,max_height=6000']);
        $file=$request->file('image');
        $name=bin2hex(random_bytes(20)).'.'.$file->guessExtension();
        if (!Storage::disk('local')->putFileAs('banners', $file, $name)) abort(500, '图片保存失败，请检查 storage 目录权限');
        return response(['data'=>['url'=>'/api/v1/guest/banner/image/'.$name]]);
    }
}
