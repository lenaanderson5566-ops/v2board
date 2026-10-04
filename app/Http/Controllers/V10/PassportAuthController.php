<?php
namespace App\Http\Controllers\V10;
class PassportAuthController extends ResourceController
{
    public function postAuthRegistrations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthRegistrations');
        $result = app(\App\Services\Actions\Passport\AuthActions::class)->register($this->businessRequest($request, \App\Http\Requests\Passport\AuthRegister::class));
        return $this->respond($request, $result, 'postAuthRegistrations');
    }
    public function postAuthSessions(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthSessions');
        $result = app(\App\Services\Actions\Passport\AuthActions::class)->login($this->businessRequest($request, \App\Http\Requests\Passport\AuthLogin::class));
        return $this->respond($request, $result, 'postAuthSessions');
    }
    public function postAuthSessionExchanges(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthSessionExchanges');
        $result = app(\App\Services\Actions\Passport\AuthActions::class)->token2Login($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postAuthSessionExchanges');
    }
    public function postAuthPasswordResets(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthPasswordResets');
        $result = app(\App\Services\Actions\Passport\AuthActions::class)->forget($this->businessRequest($request, \App\Http\Requests\Passport\AuthForget::class));
        return $this->respond($request, $result, 'postAuthPasswordResets');
    }
    public function postAuthLoginLinks(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postAuthLoginLinks');
        $result = app(\App\Services\Actions\Passport\AuthActions::class)->getQuickLoginUrl($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postAuthLoginLinks');
    }
}
