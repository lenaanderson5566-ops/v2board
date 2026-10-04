<?php
namespace App\Http\Controllers\V1\User;

class UsageResetController extends \App\Http\Controllers\Controller
{
    public function fetch(\Illuminate\Http\Request $request, \App\Services\UsageResetService $service)
    {
        return app(\App\Services\Actions\User\UsageResetActions::class)->fetch($request, $service);
    }
    public function consume(\Illuminate\Http\Request $request, \App\Services\UsageResetService $service)
    {
        return app(\App\Services\Actions\User\UsageResetActions::class)->consume($request, $service);
    }
}
