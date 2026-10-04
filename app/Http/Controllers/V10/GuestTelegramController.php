<?php
namespace App\Http\Controllers\V10;
class GuestTelegramController extends ResourceController
{
    public function postWebhooksTelegram(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postWebhooksTelegram');
        $result = app(\App\Services\Actions\Guest\TelegramActions::class)->webhook($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postWebhooksTelegram');
    }
}
