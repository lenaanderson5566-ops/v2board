<?php
namespace App\Http\Controllers\V1\Passport;

class AuthController extends \App\Http\Controllers\Controller
{
    public function register(\App\Http\Requests\Passport\AuthRegister $request)
    {
        return app(\App\Services\Actions\Passport\AuthActions::class)->register($request);
    }
    public function login(\App\Http\Requests\Passport\AuthLogin $request)
    {
        return app(\App\Services\Actions\Passport\AuthActions::class)->login($request);
    }
    public function forget(\App\Http\Requests\Passport\AuthForget $request)
    {
        return app(\App\Services\Actions\Passport\AuthActions::class)->forget($request);
    }
}
