<?php
namespace App\Http\Controllers\V1\User;

class UserController extends \App\Http\Controllers\Controller
{
    public function logout(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->logout($request);
    }
    public function unbindTelegram(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->unbindTelegram($request);
    }
    public function resetSecurity(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->resetSecurity($request);
    }
    public function info(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->info($request);
    }
    public function newPeriod(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->newPeriod($request);
    }
    public function redeemgiftcard(\App\Http\Requests\User\UserRedeemGiftCard $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->redeemgiftcard($request);
    }
    public function changePassword(\App\Http\Requests\User\UserChangePassword $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->changePassword($request);
    }
    public function update(\App\Http\Requests\User\UserUpdate $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->update($request);
    }
    public function getSubscribe(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->getSubscribe($request);
    }
    public function getStat(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->getStat($request);
    }
    public function checkLogin(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->checkLogin($request);
    }
    public function transfer(\App\Http\Requests\User\UserTransfer $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->transfer($request);
    }
    public function getQuickLoginUrl(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->getQuickLoginUrl($request);
    }
    public function getActiveSession(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->getActiveSession($request);
    }
    public function removeActiveSession(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\UserActions::class)->removeActiveSession($request);
    }
}
