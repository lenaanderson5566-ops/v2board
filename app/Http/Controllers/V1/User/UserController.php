<?php
namespace App\Http\Controllers\V1\User;

class UserController extends \App\Http\Controllers\Controller
{
    public function logout(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->logout($request);
    }
    public function info(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->info($request);
    }
    public function update(\App\Http\Requests\User\UserUpdate $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->update($request);
    }
}
