<?php
namespace App\Http\Controllers\V1\Guest;
use App\Http\Controllers\Controller;
use App\Models\Banner;
use App\Services\ProductMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
class BannerController extends Controller
{
    public function fetch(Request $request)
    {
        $data=$request->validate(['placement'=>'required|in:landing,dashboard']);
        if (!Schema::hasTable('v2_banner')) return response(['data'=>[]]);
        $locale=ProductMail::language($request->header('Content-Language') ?: app()->getLocale());
        $now=time();
        $banners=Banner::where('show', true)
            ->where(function ($q) use ($now) { $q->whereNull('starts_at')->orWhere('starts_at','<=',$now); })
            ->where(function ($q) use ($now) { $q->whereNull('ends_at')->orWhere('ends_at','>',$now); })
            ->orderBy('sort')->orderByDesc('id')->get()
            ->filter(function ($banner) use ($data, $locale) {
                return in_array($data['placement'], $banner->placements ?? [], true)
                    && (!$banner->languages || in_array($locale, $banner->languages, true));
            })->take(6)->values()->map(function ($banner) {
                return $banner->only(['id','title','image_url','mobile_image_url','target_url']);
            });
        return response(['data'=>$banners])->header('Cache-Control','no-cache, private');
    }
    public function image($name)
    {
        abort_unless(preg_match('/^[a-f0-9]{40}\.(png|jpe?g|webp)$/', $name), 404);
        $disk=Storage::disk('local');
        abort_unless($disk->exists('banners/'.$name),404);
        return response()->file($disk->path('banners/'.$name), [
            'Cache-Control'=>'public, max-age=31536000, immutable', 'X-Content-Type-Options'=>'nosniff',
        ]);
    }
}
