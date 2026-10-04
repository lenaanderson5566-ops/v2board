<?php
namespace App\Http\Controllers\V1\User;

class NoticeController extends \App\Http\Controllers\Controller
{
    public function inbox(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\NoticeActions::class)->inbox($request);
    }
    public function read(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\NoticeActions::class)->read($request);
    }
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\NoticeActions::class)->fetch($request);
    }
}
