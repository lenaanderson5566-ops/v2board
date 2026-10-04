<?php
namespace App\Http\Controllers\V1\User;

class AppleAccountController extends \App\Http\Controllers\Controller
{
    public function fetch(\Illuminate\Http\Request $request, \App\Services\AppleAccountService $service)
    {
        return app(\App\Services\Actions\User\AppleAccountActions::class)->fetch($request, $service);
    }
}
