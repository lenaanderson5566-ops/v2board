<?php
namespace App\Http\Controllers\V10;
class GuestBannerController extends ResourceController
{
    public function getPublicBanners(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicBanners');
        $result = app(\App\Services\Actions\Guest\BannerActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPublicBanners');
    }
    public function getPublicBannerImagesName(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicBannerImagesName');
        $result = app(\App\Services\Actions\Guest\BannerActions::class)->image($request->route('name'));
        return $this->respond($request, $result, 'getPublicBannerImagesName');
    }
}
