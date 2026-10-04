<?php
namespace App\Http\Controllers\V1\User;

class StatController extends \App\Http\Controllers\Controller
{
    public function getTrafficLog(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\StatActions::class)->getTrafficLog($request);
    }
}
