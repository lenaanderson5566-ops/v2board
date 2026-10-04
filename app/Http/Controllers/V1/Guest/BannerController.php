<?php
namespace App\Http\Controllers\V1\Guest;

class BannerController extends \App\Http\Controllers\Controller
{
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\Guest\BannerActions::class)->fetch($request);
    }
    public function image($name)
    {
        return app(\App\Services\Actions\Guest\BannerActions::class)->image($name);
    }
}
