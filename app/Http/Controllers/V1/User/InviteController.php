<?php
namespace App\Http\Controllers\V1\User;

class InviteController extends \App\Http\Controllers\Controller
{
    public function save(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\InviteActions::class)->save($request);
    }
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\InviteActions::class)->fetch($request);
    }
    public function details(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\InviteActions::class)->details($request);
    }
    public function sendEmail(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\InviteActions::class)->sendEmail($request);
    }
    public function emailHistory(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\InviteActions::class)->emailHistory($request);
    }
}
