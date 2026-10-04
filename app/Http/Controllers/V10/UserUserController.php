<?php
namespace App\Http\Controllers\V10;
class UserUserController extends ResourceController
{
    public function deleteMeSession(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'deleteMeSession');
        $result = app(\App\Services\Actions\User\UserActions::class)->logout($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'deleteMeSession');
    }
    public function deleteMeIntegrationsTelegram(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'deleteMeIntegrationsTelegram');
        $result = app(\App\Services\Actions\User\UserActions::class)->unbindTelegram($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'deleteMeIntegrationsTelegram');
    }
    public function postMeSubscriptionCredentialRotations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeSubscriptionCredentialRotations');
        $result = app(\App\Services\Actions\User\UserActions::class)->resetSecurity($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeSubscriptionCredentialRotations');
    }
    public function getMe(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMe');
        $result = app(\App\Services\Actions\User\UserActions::class)->info($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMe');
    }
    public function postMeSubscriptionPeriodAdvances(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeSubscriptionPeriodAdvances');
        $result = app(\App\Services\Actions\User\UserActions::class)->newPeriod($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeSubscriptionPeriodAdvances');
    }
    public function postMeGiftCardRedemptions(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeGiftCardRedemptions');
        $result = app(\App\Services\Actions\User\UserActions::class)->redeemgiftcard($this->businessRequest($request, \App\Http\Requests\User\UserRedeemGiftCard::class));
        return $this->respond($request, $result, 'postMeGiftCardRedemptions');
    }
    public function patchMePassword(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'patchMePassword');
        $result = app(\App\Services\Actions\User\UserActions::class)->changePassword($this->businessRequest($request, \App\Http\Requests\User\UserChangePassword::class));
        return $this->respond($request, $result, 'patchMePassword');
    }
    public function patchMe(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'patchMe');
        $result = app(\App\Services\Actions\User\UserActions::class)->update($this->businessRequest($request, \App\Http\Requests\User\UserUpdate::class));
        return $this->respond($request, $result, 'patchMe');
    }
    public function getMeSubscription(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeSubscription');
        $result = app(\App\Services\Actions\User\UserActions::class)->getSubscribe($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeSubscription');
    }
    public function getMeSummary(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeSummary');
        $result = app(\App\Services\Actions\User\UserActions::class)->getStat($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeSummary');
    }
    public function getMeSession(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeSession');
        $result = app(\App\Services\Actions\User\UserActions::class)->checkLogin($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeSession');
    }
    public function postMeCommissionTransfers(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeCommissionTransfers');
        $result = app(\App\Services\Actions\User\UserActions::class)->transfer($this->businessRequest($request, \App\Http\Requests\User\UserTransfer::class));
        return $this->respond($request, $result, 'postMeCommissionTransfers');
    }
    public function postMeLoginLinks(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeLoginLinks');
        $result = app(\App\Services\Actions\User\UserActions::class)->getQuickLoginUrl($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeLoginLinks');
    }
    public function getMeSessions(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeSessions');
        $result = app(\App\Services\Actions\User\UserActions::class)->getActiveSession($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeSessions');
    }
    public function deleteMeSessionsSessionId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'deleteMeSessionsSessionId');
        $result = app(\App\Services\Actions\User\UserActions::class)->removeActiveSession($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'deleteMeSessionsSessionId');
    }
}
