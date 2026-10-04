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
}
