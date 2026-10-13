<?php
namespace App\Http\Controllers\V10;
class UserTelegramController extends ResourceController
{
    public function getMeIntegrationsTelegram(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeIntegrationsTelegram');
        $result = app(\App\Services\Actions\User\TelegramActions::class)->getBotInfo();
        return $this->respond($request, $result, 'getMeIntegrationsTelegram');
    }
    public function postMeIntegrationsTelegramBindingLinks(\Illuminate\Http\Request $request) {
        $this->prepare($request, 'postMeIntegrationsTelegramBindingLinks');
        $result=app(\App\Services\Actions\User\TelegramActions::class)->bindingLink($request);
        return $this->respond($request,$result,'postMeIntegrationsTelegramBindingLinks');
    }
    public function postMeIntegrationsTelegramConfirmation(\Illuminate\Http\Request $request) {
        $this->prepare($request, 'postMeIntegrationsTelegramConfirmation');
        $result=app(\App\Services\Actions\User\TelegramActions::class)->confirmBinding($request);
        return $this->respond($request,$result,'postMeIntegrationsTelegramConfirmation');
    }
    public function postMeIntegrationsTelegramGroupInvitations(\Illuminate\Http\Request $request) {
        $this->prepare($request, 'postMeIntegrationsTelegramGroupInvitations');
        $result=app(\App\Services\Actions\User\TelegramActions::class)->joinLink($request);
        return $this->respond($request,$result,'postMeIntegrationsTelegramGroupInvitations');
    }
}
